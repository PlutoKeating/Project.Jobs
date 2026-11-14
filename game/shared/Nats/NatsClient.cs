// 极简 NATS 核心文本协议客户端（无 NuGet 依赖）。TShock 插件与 tModLoader mod 共用。
// 支持：CONNECT / PUB / SUB / UNSUB / MSG（按字节数读取载荷，可处理 >64KB）/ HMSG（忽略头部）/
// PING / PONG / 请求-应答（每个连接一个通配收件箱）/ 断线自动重连并恢复订阅。
// 不支持：TLS、认证令牌之外的鉴权方式、JetStream API（需要时用普通请求-应答调用 $JS.API.*）。
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace JobsWorld.Shared.Nats
{
    public sealed class NatsMsg
    {
        public string Subject = "";
        public string? ReplyTo;
        public byte[] Data = Array.Empty<byte>();
        public string Text => Encoding.UTF8.GetString(Data);
    }

    public sealed class NatsClient : IDisposable
    {
        private readonly string _host;
        private readonly int _port;
        private readonly string? _user;
        private readonly string? _pass;
        private readonly string? _token;
        private readonly string _name;
        private readonly Action<string> _log;
        private readonly object _writeLock = new object();
        private readonly ConcurrentDictionary<int, (string subject, string? queue, Action<NatsMsg> handler)> _subs = new();
        private readonly ConcurrentDictionary<string, TaskCompletionSource<NatsMsg>> _pending = new();
        private readonly string _inboxPrefix;
        private int _nextSid;
        private int _inboxSid = -1;
        private TcpClient? _tcp;
        private Stream? _stream;
        private Thread? _thread;
        private volatile bool _disposed;
        private volatile bool _connected;
        private long _reqCounter;

        public bool Connected => _connected;
        /// <summary>连接建立（含重连）后回调，在读线程上执行</summary>
        public event Action? OnConnected;

        public NatsClient(string url, string name, Action<string>? log = null)
        {
            var u = new Uri(url.Contains("://") ? url : "nats://" + url);
            _host = u.Host;
            _port = u.Port > 0 ? u.Port : 4222;
            if (!string.IsNullOrEmpty(u.UserInfo))
            {
                var parts = u.UserInfo.Split(new[] { ':' }, 2);
                if (parts.Length == 2) { _user = Uri.UnescapeDataString(parts[0]); _pass = Uri.UnescapeDataString(parts[1]); }
                else _token = Uri.UnescapeDataString(parts[0]);
            }
            _name = name;
            _log = log ?? (_ => { });
            _inboxPrefix = "_INBOX." + Guid.NewGuid().ToString("N").Substring(0, 22);
        }

        /// <summary>启动后台连接线程（立即返回；断线后自动重连）</summary>
        public void Start()
        {
            if (_thread != null) return;
            _thread = new Thread(Loop) { IsBackground = true, Name = "jw-nats" };
            _thread.Start();
        }

        public int Subscribe(string subject, Action<NatsMsg> handler, string? queue = null)
        {
            int sid = Interlocked.Increment(ref _nextSid);
            _subs[sid] = (subject, queue, handler);
            if (_connected) TrySend(SubLine(sid, subject, queue));
            return sid;
        }

        public void Unsubscribe(int sid)
        {
            if (_subs.TryRemove(sid, out _) && _connected) TrySend(Encoding.ASCII.GetBytes($"UNSUB {sid}\r\n"));
        }

        public bool Publish(string subject, string text, string? replyTo = null) => Publish(subject, Encoding.UTF8.GetBytes(text), replyTo);

        public bool Publish(string subject, byte[] data, string? replyTo = null)
        {
            var head = Encoding.UTF8.GetBytes(replyTo == null ? $"PUB {subject} {data.Length}\r\n" : $"PUB {subject} {replyTo} {data.Length}\r\n");
            var buf = new byte[head.Length + data.Length + 2];
            Buffer.BlockCopy(head, 0, buf, 0, head.Length);
            Buffer.BlockCopy(data, 0, buf, head.Length, data.Length);
            buf[buf.Length - 2] = (byte)'\r';
            buf[buf.Length - 1] = (byte)'\n';
            return TrySend(buf);
        }

        /// <summary>请求-应答。超时或未连接时抛出 TimeoutException</summary>
        public async Task<NatsMsg> RequestAsync(string subject, byte[] data, TimeSpan timeout)
        {
            if (!_connected) throw new TimeoutException("NATS 未连接");
            var token = Interlocked.Increment(ref _reqCounter).ToString();
            var tcs = new TaskCompletionSource<NatsMsg>(TaskCreationOptions.RunContinuationsAsynchronously);
            _pending[token] = tcs;
            try
            {
                if (!Publish(subject, data, _inboxPrefix + "." + token)) throw new TimeoutException("NATS 发送失败");
                var done = await Task.WhenAny(tcs.Task, Task.Delay(timeout)).ConfigureAwait(false);
                if (done != tcs.Task) throw new TimeoutException($"请求 {subject} 超时");
                return await tcs.Task.ConfigureAwait(false);
            }
            finally { _pending.TryRemove(token, out _); }
        }

        public Task<NatsMsg> RequestAsync(string subject, string text, TimeSpan timeout) => RequestAsync(subject, Encoding.UTF8.GetBytes(text), timeout);

        // ---------------- 内部 ----------------

        private static byte[] SubLine(int sid, string subject, string? queue) =>
            Encoding.UTF8.GetBytes(queue == null ? $"SUB {subject} {sid}\r\n" : $"SUB {subject} {queue} {sid}\r\n");

        private bool TrySend(byte[] buf)
        {
            var s = _stream;
            if (s == null) return false;
            try
            {
                lock (_writeLock) { s.Write(buf, 0, buf.Length); s.Flush(); }
                return true;
            }
            catch (Exception e) { _log("NATS 写入失败: " + e.Message); Drop(); return false; }
        }

        private void Drop()
        {
            _connected = false;
            try { _tcp?.Close(); } catch { }
            _stream = null;
        }

        private void Loop()
        {
            int backoff = 500;
            while (!_disposed)
            {
                try
                {
                    _tcp = new TcpClient { NoDelay = true, ReceiveBufferSize = 1 << 20 };
                    _tcp.Connect(_host, _port);
                    var stream = _tcp.GetStream();
                    var reader = new NatsReader(stream);
                    // 第一行必须是 INFO
                    var info = reader.ReadLine();
                    if (info == null || !info.StartsWith("INFO", StringComparison.Ordinal)) throw new IOException("NATS 握手失败: " + info);
                    var sb = new StringBuilder();
                    sb.Append("{\"verbose\":false,\"pedantic\":false,\"lang\":\"csharp-mini\",\"version\":\"0.1.0\",\"protocol\":1,\"headers\":true,\"no_responders\":true");
                    sb.Append(",\"name\":").Append(JsonStr(_name));
                    if (_user != null) sb.Append(",\"user\":").Append(JsonStr(_user)).Append(",\"pass\":").Append(JsonStr(_pass ?? ""));
                    if (_token != null) sb.Append(",\"auth_token\":").Append(JsonStr(_token));
                    sb.Append('}');
                    _stream = stream;
                    var hello = new MemoryStream();
                    void W(string s) { var b = Encoding.UTF8.GetBytes(s); hello.Write(b, 0, b.Length); }
                    W("CONNECT " + sb + "\r\n");
                    // 恢复订阅（含收件箱）
                    _inboxSid = Interlocked.Increment(ref _nextSid);
                    W($"SUB {_inboxPrefix}.* {_inboxSid}\r\n");
                    foreach (var kv in _subs) W(Encoding.UTF8.GetString(SubLine(kv.Key, kv.Value.subject, kv.Value.queue)));
                    W("PING\r\n");
                    var hb = hello.ToArray();
                    lock (_writeLock) { stream.Write(hb, 0, hb.Length); stream.Flush(); }
                    _connected = true;
                    backoff = 500;
                    _log($"NATS 已连接 {_host}:{_port}");
                    try { OnConnected?.Invoke(); } catch (Exception e) { _log("OnConnected 回调异常: " + e); }
                    ReadLoop(reader);
                }
                catch (Exception e)
                {
                    if (!_disposed) _log($"NATS 连接中断（{e.GetType().Name}: {e.Message}），{backoff}ms 后重连");
                }
                Drop();
                foreach (var kv in _pending) kv.Value.TrySetException(new TimeoutException("NATS 连接中断"));
                if (_disposed) break;
                Thread.Sleep(backoff);
                backoff = Math.Min(backoff * 2, 10_000);
            }
        }

        private void ReadLoop(NatsReader r)
        {
            while (!_disposed)
            {
                var line = r.ReadLine();
                if (line == null) throw new IOException("连接被关闭");
                if (line.Length == 0) continue;
                if (line.StartsWith("MSG ", StringComparison.Ordinal))
                {
                    // MSG <subject> <sid> [reply-to] <#bytes>
                    var p = line.Split(' ');
                    int n = int.Parse(p[p.Length - 1]);
                    var msg = new NatsMsg { Subject = p[1], ReplyTo = p.Length == 5 ? p[3] : null, Data = r.ReadPayload(n) };
                    Dispatch(int.Parse(p[2]), msg);
                }
                else if (line.StartsWith("HMSG ", StringComparison.Ordinal))
                {
                    // HMSG <subject> <sid> [reply-to] <#header bytes> <#total bytes>
                    var p = line.Split(' ');
                    int total = int.Parse(p[p.Length - 1]);
                    int hdr = int.Parse(p[p.Length - 2]);
                    var all = r.ReadPayload(total);
                    var data = new byte[total - hdr];
                    Buffer.BlockCopy(all, hdr, data, 0, data.Length);
                    var headers = Encoding.UTF8.GetString(all, 0, hdr);
                    var msg = new NatsMsg { Subject = p[1], ReplyTo = p.Length == 6 ? p[3] : null, Data = data };
                    // 503 No Responders：立即让请求失败
                    if (data.Length == 0 && headers.Contains(" 503")) { FailRequest(msg.Subject, "没有服务应答（世界服务未运行？）"); continue; }
                    Dispatch(int.Parse(p[2]), msg);
                }
                else if (line == "PING") TrySend(Encoding.ASCII.GetBytes("PONG\r\n"));
                else if (line == "PONG" || line == "+OK" || line.StartsWith("INFO", StringComparison.Ordinal)) { }
                else if (line.StartsWith("-ERR", StringComparison.Ordinal))
                {
                    _log("NATS 服务器错误: " + line);
                    if (line.Contains("Authorization") || line.Contains("Stale")) throw new IOException(line);
                }
            }
        }

        private void FailRequest(string subject, string reason)
        {
            if (!subject.StartsWith(_inboxPrefix + ".", StringComparison.Ordinal)) return;
            var token = subject.Substring(_inboxPrefix.Length + 1);
            if (_pending.TryRemove(token, out var tcs)) tcs.TrySetException(new TimeoutException(reason));
        }

        private void Dispatch(int sid, NatsMsg msg)
        {
            if (sid == _inboxSid)
            {
                var token = msg.Subject.Substring(_inboxPrefix.Length + 1);
                if (_pending.TryRemove(token, out var tcs)) tcs.TrySetResult(msg);
                return;
            }
            if (_subs.TryGetValue(sid, out var s))
            {
                try { s.handler(msg); } catch (Exception e) { _log($"NATS 订阅回调异常 {msg.Subject}: {e}"); }
            }
        }

        private static string JsonStr(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (var c in s)
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }

        public void Dispose()
        {
            _disposed = true;
            Drop();
        }

        /// <summary>带缓冲的协议读取器：按行读控制行，按字节数读载荷</summary>
        private sealed class NatsReader
        {
            private readonly Stream _s;
            private readonly byte[] _buf = new byte[64 * 1024];
            private int _pos, _len;

            public NatsReader(Stream s) { _s = s; }

            private bool Fill()
            {
                if (_pos < _len) return true;
                _pos = 0;
                _len = _s.Read(_buf, 0, _buf.Length);
                return _len > 0;
            }

            public string? ReadLine()
            {
                var line = new List<byte>(128);
                while (true)
                {
                    if (!Fill()) return null;
                    byte b = _buf[_pos++];
                    if (b == (byte)'\n')
                    {
                        if (line.Count > 0 && line[line.Count - 1] == (byte)'\r') line.RemoveAt(line.Count - 1);
                        return Encoding.UTF8.GetString(line.ToArray());
                    }
                    line.Add(b);
                }
            }

            /// <summary>读取 n 字节载荷以及结尾的 \r\n</summary>
            public byte[] ReadPayload(int n)
            {
                var data = new byte[n];
                int got = 0;
                while (got < n)
                {
                    if (!Fill()) throw new IOException("读取载荷时连接关闭");
                    int take = Math.Min(n - got, _len - _pos);
                    Buffer.BlockCopy(_buf, _pos, data, got, take);
                    _pos += take; got += take;
                }
                // 吃掉 \r\n
                for (int i = 0; i < 2; i++) { if (!Fill()) throw new IOException("读取载荷结尾时连接关闭"); _pos++; }
                return data;
            }
        }
    }
}

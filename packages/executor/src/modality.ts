import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dataPath, logger } from '@pux/core';
import { gateway, vertexAccess } from '@pux/llm';

const run = promisify(execFile);

/** 模态注入（§11.2）：语音 → Chromium fake audio；相机 → fake video（y4m）；定位/通知由 BrowserSession 处理 */
export class ModalityFiles {
  readonly dir: string;
  readonly audioPath: string;
  readonly videoPath: string;
  constructor(sessionId: string) {
    this.dir = dataPath('runtime', sessionId);
    mkdirSync(this.dir, { recursive: true });
    this.audioPath = join(this.dir, 'mic.wav');
    this.videoPath = join(this.dir, 'camera.y4m');
  }
  /** 启动前准备占位文件（Chromium 要求文件存在） */
  async prepare() {
    if (!existsSync(this.audioPath)) await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '1', '-acodec', 'pcm_s16le', this.audioPath]);
    if (!existsSync(this.videoPath)) await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=640x480:r=10', '-t', '2', '-pix_fmt', 'yuv420p', this.videoPath]);
  }
  launchArgs() {
    return ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${this.audioPath}`, `--use-file-for-fake-video-capture=${this.videoPath}`, '--autoplay-policy=no-user-gesture-required'];
  }
  /** speak：TTS 生成语音写入麦克风文件 */
  async speak(text: string, locale = 'zh-CN'): Promise<{ ok: boolean; engine: string; seconds: number }> {
    const raw = join(this.dir, 'tts_raw.wav');
    let engine = 'gemini-tts';
    try { const buf = await vertexTts(text); writeFileSync(raw, buf); }
    catch (e) {
      logger.debug({ err: String(e).slice(0, 200) }, '没有可用的 Gemini 语音合成，改用 espeak');
      engine = 'espeak';
      await run('espeak', ['-v', locale.startsWith('zh') ? 'zh' : 'en', '-w', raw, text]).catch(() => run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=2', raw]));
    }
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', raw, '-af', 'apad=pad_dur=1', '-ar', '48000', '-ac', '1', '-acodec', 'pcm_s16le', this.audioPath]);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', this.audioPath]).catch(() => ({ stdout: '2' }));
    return { ok: true, engine, seconds: Number(stdout) || 2 };
  }
  /** show_camera：图片（文件或生成）→ y4m */
  async showCamera(opts: { imagePath?: string; prompt?: string }): Promise<{ ok: boolean; source: string; image?: Buffer }> {
    let img = opts.imagePath;
    let buf: Buffer | undefined;
    if (!img && opts.prompt) {
      const g = await gateway().generateImage(`一张用手机拍摄的真实照片：${opts.prompt}`);
      if (g) { img = join(this.dir, 'camera_src.png'); writeFileSync(img, g); buf = g; }
    }
    if (!img) return { ok: false, source: 'none' };
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-loop', '1', '-i', img, '-t', '3', '-r', '10', '-vf', 'scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2', '-pix_fmt', 'yuv420p', this.videoPath]);
    return { ok: true, source: opts.imagePath ? 'file' : 'generated', image: buf };
  }
}

/** Gemini 语音合成：借用「模型」里接入的 Vertex 连接。没有接入 Vertex 时抛错，由调用方改用本机的 espeak */
export async function vertexTts(text: string): Promise<Buffer> {
  const v = await vertexAccess(); if (!v) throw new Error('没有接入 Vertex 连接');
  const model = process.env.PUX_TTS_MODEL ?? 'gemini-3.8-flash-tts';
  const r = await fetch(`${v.base}/publishers/google/models/${model}:generateContent`, {
    method: 'POST', headers: { Authorization: `Bearer ${v.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'] } }),
  });
  if (!r.ok) throw new Error(`TTS HTTP ${r.status}`);
  const d = await r.json() as { candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[] };
  const part = d.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData) throw new Error('TTS 无音频');
  const buf = Buffer.from(part.inlineData.data, 'base64');
  if (part.inlineData.mimeType.includes('wav')) return buf;
  // L16 PCM → WAV 头
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + buf.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(buf.length, 40);
  return Buffer.concat([h, buf]);
}

// NATS 消息 DTO：与 packages/jobsworld/src/protocol.ts 一一对应（字段名保持 snake_case）。
// 只用 System.Text.Json，TShock（.NET 9）与 tModLoader（.NET 8）都可用。
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace JobsWorld.Shared.Protocol
{
    public static class Subjects
    {
        public const string Clock = "jw.clock";
        public const string Snapshot = "jw.snapshot";
        public const string SayAll = "jw.persona.*.say";
        public const string LiveAll = "jw.persona.*.live";
        public const string Town = "jw.town";
        public const string CmdClock = "jw.cmd.clock";
        public const string CmdEvent = "jw.cmd.event";
        public const string CmdReplay = "jw.cmd.replay";
        public const string Detail = "jw.detail";
        public const string Ask = "jw.ask";
    }

    public static class Json
    {
        public static readonly JsonSerializerOptions Options = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            NumberHandling = JsonNumberHandling.AllowReadingFromString,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };

        public static T? Parse<T>(byte[] data) => JsonSerializer.Deserialize<T>(data, Options);
        public static T? Parse<T>(string text) => JsonSerializer.Deserialize<T>(text, Options);
        public static string Stringify<T>(T value) => JsonSerializer.Serialize(value, Options);
    }

    public sealed class ClockMsg
    {
        [JsonPropertyName("date")] public string Date { get; set; } = "";
        [JsonPropertyName("day")] public int Day { get; set; }
        [JsonPropertyName("minute")] public double Minute { get; set; }
        [JsonPropertyName("clock")] public string Clock { get; set; } = "";
        [JsonPropertyName("speed")] public double Speed { get; set; } = 1;
        [JsonPropertyName("paused")] public bool Paused { get; set; }
    }

    public sealed class Appearance
    {
        [JsonPropertyName("hair")] public int Hair { get; set; }
        [JsonPropertyName("skinVariant")] public int SkinVariant { get; set; }
        [JsonPropertyName("hairColor")] public int[] HairColor { get; set; } = { 34, 26, 22 };
        [JsonPropertyName("skinColor")] public int[] SkinColor { get; set; } = { 241, 194, 160 };
        [JsonPropertyName("eyeColor")] public int[] EyeColor { get; set; } = { 60, 40, 30 };
        [JsonPropertyName("shirtColor")] public int[] ShirtColor { get; set; } = { 110, 140, 120 };
        [JsonPropertyName("underShirtColor")] public int[] UnderShirtColor { get; set; } = { 235, 230, 220 };
        [JsonPropertyName("pantsColor")] public int[] PantsColor { get; set; } = { 64, 70, 90 };
        [JsonPropertyName("shoeColor")] public int[] ShoeColor { get; set; } = { 60, 46, 38 };
        [JsonPropertyName("vanity")] public int[] Vanity { get; set; } = { 0, 0, 0 };
        [JsonPropertyName("held")] public int Held { get; set; }

        /// <summary>外观指纹：变化时才重发 PlayerInfo</summary>
        public string Key() => string.Join(",", Hair, SkinVariant, string.Join(".", HairColor), string.Join(".", SkinColor), string.Join(".", EyeColor),
            string.Join(".", ShirtColor), string.Join(".", UnderShirtColor), string.Join(".", PantsColor), string.Join(".", ShoeColor), string.Join(".", Vanity), Held);
    }

    public sealed class AgendaRef
    {
        [JsonPropertyName("from")] public string From { get; set; } = "";
        [JsonPropertyName("to")] public string To { get; set; } = "";
        [JsonPropertyName("activity")] public string Activity { get; set; } = "";
        [JsonPropertyName("place_id")] public string PlaceId { get; set; } = "";
        [JsonPropertyName("intent")] public string? Intent { get; set; }
    }

    public sealed class SessionLive
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("app")] public string App { get; set; } = "";
        [JsonPropertyName("app_version")] public string? AppVersion { get; set; }
        [JsonPropertyName("step_idx")] public int StepIdx { get; set; }
        [JsonPropertyName("steps_total")] public int? StepsTotal { get; set; }
        [JsonPropertyName("monologue")] public string? Monologue { get; set; }
        [JsonPropertyName("intent")] public string? Intent { get; set; }
        [JsonPropertyName("action")] public string? Action { get; set; }
        [JsonPropertyName("decision")] public string? Decision { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("url")] public string? Url { get; set; }
        [JsonPropertyName("replay")] public bool? Replay { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; } = "";
    }

    public sealed class PersonaLive
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("locale")] public string Locale { get; set; } = "zh-CN";
        [JsonPropertyName("occupation")] public string Occupation { get; set; } = "";
        [JsonPropertyName("age")] public int Age { get; set; }
        [JsonPropertyName("gender")] public string Gender { get; set; } = "";
        [JsonPropertyName("x")] public double X { get; set; }
        [JsonPropertyName("y")] public double Y { get; set; }
        [JsonPropertyName("floor")] public int Floor { get; set; }
        [JsonPropertyName("facing")] public int Facing { get; set; } = 1;
        [JsonPropertyName("pose")] public string Pose { get; set; } = "stand";
        [JsonPropertyName("place_id")] public string PlaceId { get; set; } = "";
        [JsonPropertyName("place_kind")] public string PlaceKind { get; set; } = "";
        [JsonPropertyName("mode")] public string Mode { get; set; } = "idle";
        [JsonPropertyName("activity")] public string Activity { get; set; } = "";
        [JsonPropertyName("intent")] public string? Intent { get; set; }
        [JsonPropertyName("prev")] public AgendaRef? Prev { get; set; }
        [JsonPropertyName("next")] public AgendaRef? Next { get; set; }
        [JsonPropertyName("session")] public SessionLive? Session { get; set; }
        [JsonPropertyName("appearance")] public Appearance Appearance { get; set; } = new Appearance();
        [JsonPropertyName("visible")] public bool Visible { get; set; } = true;
    }

    public sealed class Snapshot
    {
        [JsonPropertyName("clock")] public ClockMsg Clock { get; set; } = new ClockMsg();
        [JsonPropertyName("personas")] public List<PersonaLive> Personas { get; set; } = new List<PersonaLive>();
        [JsonPropertyName("town_version")] public string TownVersion { get; set; } = "";
        [JsonPropertyName("ts")] public long Ts { get; set; }
    }

    public sealed class SayMsg
    {
        [JsonPropertyName("persona_id")] public string PersonaId { get; set; } = "";
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("text")] public string Text { get; set; } = "";
        [JsonPropertyName("tone")] public string Tone { get; set; } = "neutral";
        [JsonPropertyName("ts")] public long Ts { get; set; }
    }

    public sealed class ClockCmd
    {
        [JsonPropertyName("paused")] public bool? Paused { get; set; }
        [JsonPropertyName("speed")] public double? Speed { get; set; }
        [JsonPropertyName("jump_to")] public string? JumpTo { get; set; }
    }

    public sealed class EventCmd
    {
        [JsonPropertyName("place_id")] public string PlaceId { get; set; } = "";
        [JsonPropertyName("kind")] public string Kind { get; set; } = "";
        [JsonPropertyName("minutes")] public int? Minutes { get; set; }
        [JsonPropertyName("by")] public string? By { get; set; }
    }

    public sealed class ReplayCmd
    {
        [JsonPropertyName("session_id")] public string SessionId { get; set; } = "";
        [JsonPropertyName("speed")] public double? Speed { get; set; }
    }

    public sealed class DetailReply
    {
        [JsonPropertyName("live")] public PersonaLive? Live { get; set; }
        [JsonPropertyName("error")] public string? Error { get; set; }
    }

    public sealed class AskReply
    {
        [JsonPropertyName("answer")] public JsonElement? Answer { get; set; }
        [JsonPropertyName("busy")] public bool? Busy { get; set; }
        [JsonPropertyName("none")] public bool? None { get; set; }
        [JsonPropertyName("session_id")] public string? SessionId { get; set; }
        [JsonPropertyName("error")] public string? Error { get; set; }
    }
}

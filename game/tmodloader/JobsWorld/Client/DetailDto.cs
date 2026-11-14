// jw.detail 应答（客户端只读）：比 game/shared 的 DetailReply 多出面板需要的字段（截图证据、日程、记忆、历史 Session）。
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace JobsWorld.Client
{
    public sealed class DetailMsg
    {
        [JsonPropertyName("live")] public LiveDto? Live { get; set; }
        [JsonPropertyName("agenda")] public AgendaDto? Agenda { get; set; }
        [JsonPropertyName("memories")] public List<MemoryDto>? Memories { get; set; }
        [JsonPropertyName("sessions")] public List<SessionRowDto>? Sessions { get; set; }
        [JsonPropertyName("error")] public string? Error { get; set; }
    }

    public sealed class AgendaRefDto
    {
        [JsonPropertyName("from")] public string From { get; set; } = "";
        [JsonPropertyName("to")] public string To { get; set; } = "";
        [JsonPropertyName("activity")] public string Activity { get; set; } = "";
        [JsonPropertyName("place_id")] public string PlaceId { get; set; } = "";
        [JsonPropertyName("intent")] public string? Intent { get; set; }
    }

    public sealed class SessionDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("app")] public string App { get; set; } = "";
        [JsonPropertyName("app_version")] public string? AppVersion { get; set; }
        [JsonPropertyName("step_idx")] public int StepIdx { get; set; }
        [JsonPropertyName("steps_total")] public int? StepsTotal { get; set; }
        [JsonPropertyName("sim_clock")] public string? SimClock { get; set; }
        [JsonPropertyName("monologue")] public string? Monologue { get; set; }
        [JsonPropertyName("intent")] public string? Intent { get; set; }
        [JsonPropertyName("action")] public string? Action { get; set; }
        [JsonPropertyName("decision")] public string? Decision { get; set; }
        [JsonPropertyName("screenshot_ev")] public string? ScreenshotEv { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("url")] public string? Url { get; set; }
        [JsonPropertyName("mood")] public double? Mood { get; set; }
        [JsonPropertyName("replay")] public bool? Replay { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; } = "";
    }

    public sealed class LiveDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("occupation")] public string Occupation { get; set; } = "";
        [JsonPropertyName("age")] public int Age { get; set; }
        [JsonPropertyName("gender")] public string Gender { get; set; } = "";
        [JsonPropertyName("place_id")] public string PlaceId { get; set; } = "";
        [JsonPropertyName("floor")] public int Floor { get; set; }
        [JsonPropertyName("mode")] public string Mode { get; set; } = "idle";
        [JsonPropertyName("activity")] public string Activity { get; set; } = "";
        [JsonPropertyName("intent")] public string? Intent { get; set; }
        [JsonPropertyName("prev")] public AgendaRefDto? Prev { get; set; }
        [JsonPropertyName("next")] public AgendaRefDto? Next { get; set; }
        [JsonPropertyName("session")] public SessionDto? Session { get; set; }
    }

    public sealed class AgendaItemDto
    {
        [JsonPropertyName("from")] public string From { get; set; } = "";
        [JsonPropertyName("to")] public string To { get; set; } = "";
        [JsonPropertyName("place_id")] public string PlaceId { get; set; } = "";
        [JsonPropertyName("activity")] public string Activity { get; set; } = "";
        [JsonPropertyName("intent")] public string? Intent { get; set; }
    }

    public sealed class AgendaDto
    {
        [JsonPropertyName("items")] public List<AgendaItemDto> Items { get; set; } = new List<AgendaItemDto>();
    }

    public sealed class MemoryDto
    {
        [JsonPropertyName("kind")] public string Kind { get; set; } = "";
        [JsonPropertyName("content")] public string Content { get; set; } = "";
    }

    public sealed class SessionRowDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("app")] public string App { get; set; } = "";
        [JsonPropertyName("outcome")] public string? Outcome { get; set; }
        [JsonPropertyName("steps")] public int Steps { get; set; }
    }
}

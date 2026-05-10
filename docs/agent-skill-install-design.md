# OpenTrends Agent Skill Install Page Design

## Goal

Add a public page that helps platform users install the OpenTrends agent skill,
then use agents to read OpenTrends content through the structured API.

The page is for users, not repository contributors. It should not explain the
OpenTrends codebase, source adapter internals, deployment steps, or test
commands. Its job is to make installation clear and make the skill contract
discoverable.

## User Jobs

- Install the OpenTrends skill into an agent runtime.
- Copy one instruction and send it to the user's agent.
- Understand that the skill reads `https://api.opentrends.io`, not the web UI.
- See example prompts that work after installation.
- Confirm which topics and API endpoints the installed skill will use.
- Know that the skill checks for updates before API requests.

## Proposed Routes

```txt
/skills/opentrends
/zh/skills/opentrends
/zh-Hant/skills/opentrends
/ru/skills/opentrends
```

The localized pages should use the existing locale path pattern. English can be
the default route without a locale prefix.

## Page Structure

### Header

Primary message:

```txt
Use OpenTrends from your agent
```

Supporting copy:

```txt
Install the OpenTrends skill so your agent can read structured trend data from
the OpenTrends API and summarize current topics with source links.
```

Primary action:

```txt
Copy install prompt
```

The primary action copies the exact sentence that the user should send to their
agent. The agent owns installing the skill into the correct local or platform
directory.

Secondary action:

```txt
View API contract
```

This scrolls to the API contract section.

### Install Prompt

The install section should look like a copyable prompt, not a package manager
guide.

```txt
在你的 Agent 里直接发这句话，Agent 会自己安装到对应目录，不用你操心路径：

帮我安装这个 skill: https://opentrends.io/skills/opentrends/SKILL.md
```

The prompt card needs:

- one large copyable prompt
- a copy button
- a one-sentence explanation that the agent handles paths and runtime-specific
  installation
- a clear note that the URL points to the AI-readable Markdown skill file
- a short confirmation hint: after install, ask the agent to summarize an
  OpenTrends topic

The page should not lead with:

```txt
Install with Multica
Install with Codex
Manual install
npm / bun / git commands
```

Those details can exist in a small fallback disclosure for advanced users, but
they should not be the primary installation experience.

### Example Prompts

Use examples that reflect real user intent:

```txt
Read OpenTrends AI and tell me the five most important updates.
Compare OpenTrends hardware and programming trends today.
Find notable biotech items from OpenTrends and include source links.
Summarize OpenTrends China tech trends in Chinese.
```

The page should make clear that users do not need to know the API URL. The skill
handles topic mapping and API calls.

### API Contract

The installed skill should use this base URL:

```txt
https://api.opentrends.io
```

Do not instruct agents to read:

```txt
https://opentrends.io/api/...
https://opentrends.io/zh/trends/...
```

The human-facing site is for browser users. The API host is for agents and other
programmatic clients.

Required endpoints:

```txt
GET /api/trends/:topic
GET /api/trends/:topic/sources/:sourceId
GET /api/trends/:topic/summary
GET /api/sources
GET /api/sources?mode=config
GET /api/skills/opentrends
```

Core query parameters:

```txt
lang=zh | en | zh-Hant | ru
items=preview | number
translations=background | sync
```

The page should display the currently supported topics from the skill manifest,
not from hardcoded marketing copy.

## Skill Update Mechanism

Agents must check for the latest skill/API contract before reading OpenTrends
content.

Before each user task, the skill instructs the agent to call:

```txt
GET https://api.opentrends.io/api/skills/opentrends
```

Suggested response:

```json
{
  "name": "opentrends",
  "version": "2026.05.08.1",
  "updatedAt": "2026-05-08T03:50:00Z",
  "baseUrl": "https://api.opentrends.io",
  "installUrl": "https://opentrends.io/skills/opentrends",
  "skillUrl": "https://opentrends.io/skills/opentrends/SKILL.md",
  "topics": [
    "ai",
    "tech",
    "programming",
    "hardware",
    "biotech",
    "embodied",
    "cn",
    "indie"
  ],
  "endpoints": {
    "topic": "/api/trends/:topic",
    "source": "/api/trends/:topic/sources/:sourceId",
    "summary": "/api/trends/:topic/summary",
    "sources": "/api/sources"
  },
  "query": {
    "lang": ["zh", "en", "zh-Hant", "ru"],
    "items": "preview | 1..defaultMax",
    "translations": ["background", "sync"]
  }
}
```

Agent behavior:

- Fetch the manifest at the start of each OpenTrends task.
- Treat the manifest as newer than local skill text when they conflict.
- Cache the manifest for only the current user request or a short window such as
  10 minutes.
- If an API request returns `topic_not_found`, `404`, or parameter errors, fetch
  the manifest again and retry once.
- If the manifest cannot be reached, fall back to the local skill text and tell
  the user that the latest skill manifest could not be checked.

## Skill Package Content

The install prompt points to a small user-facing skill package:

```txt
apps/web/public/skills/opentrends/SKILL.md
```

`SKILL.md` is the AI-readable skill file and should stay short:

- trigger on OpenTrends and trend-reading requests
- call the manifest before OpenTrends API requests
- use `https://api.opentrends.io`
- map user topic names to manifest topics
- summarize only from API JSON
- preserve source links
- do not scrape pages or invent missing data

The page should expose the current skill version and last updated timestamp from
the manifest so users can see whether they are installing the current contract.

## Installation State

The page should keep state handling lightweight:

- Default: show the copyable install prompt.
- Copied: show a transient "Copied" state.
- Advanced fallback: show raw skill URL and package files only if the user opens
  details.

Do not require the page to detect whether the skill is already installed. The
agent can handle install/update idempotently after the user sends the prompt.

## UX Requirements

- First viewport must explain what the skill does and provide the copyable
  install prompt.
- Do not make users inspect API documentation before installing.
- Do not show runtime-specific install choices unless the user opens advanced
  details.
- Keep API details collapsed or below the install section.
- Show copyable example prompts after installation.
- Include a short privacy note: the skill reads public OpenTrends API data and
  does not require a user account.
- Show failure guidance for API or manifest errors.

## Acceptance Criteria

- A public install page exists for the OpenTrends skill.
- The page's primary install UI is one copyable sentence:
  `帮我安装这个 skill: https://opentrends.io/skills/opentrends/SKILL.md`.
- `https://opentrends.io/skills/opentrends/SKILL.md` serves the AI-readable
  Markdown skill file.
- The page relies on the user's agent to install into the correct directory.
- The skill contract uses `https://api.opentrends.io` as the base URL.
- The page documents the manifest endpoint and update-check behavior.
- The installed skill tells agents to check the manifest before OpenTrends API
  requests.
- The page includes topic examples and prompts for end users.
- The page does not include repository development instructions.

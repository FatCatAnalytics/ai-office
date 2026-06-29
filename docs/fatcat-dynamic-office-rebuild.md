# FatCat Dynamic Office Rebuild

## Goal

Revamp the AI Office from a static illustration into a live, configurable multi-agent dashboard.

The core metaphor is simple: one Manager FatCat coordinates a project and delegates work to specialist FatCat agents. Each visible cat should be an independent sprite tied to live data: status, current task, progress, outputs and recent events.

## Key design decision

Do not build the final experience as one static image with labels painted into it. Use a layered product UI instead:

```text
React shell
  - CSS/SVG dark isometric office background
  - independent transparent FatCat sprites
  - live status glows and in-place micro animations
  - React tooltips and detail panels
  - backend-driven activity feed and task stream
```

The existing static image remains useful as a visual reference, but the final app should not rely on baked-in cats or baked-in labels.

## Visual direction

The background should feel like a premium AI command centre:

- dark navy, slate and charcoal base
- isometric floor perspective
- blue, cyan and violet neon accents
- warm desk lamps for contrast
- glassmorphism panels
- holographic screens
- desks, plants, shelves and consoles
- no large floating boxes around cats
- no role labels baked into generated artwork

Suggested tokens:

```css
--bg-0: #030712;
--bg-1: #07111f;
--panel: rgba(15, 23, 42, 0.76);
--panel-border: rgba(148, 163, 184, 0.14);
--cyan: #22d3ee;
--blue: #3b82f6;
--violet: #8b5cf6;
--emerald: #10b981;
--amber: #f59e0b;
--rose: #f43f5e;
```

## Recommended seat model

Use percentage anchors, not pixels:

```ts
export const OFFICE_SEATS = {
  manager:     { x: 50, y: 28, scale: 1.18, z: 40 },
  research:    { x: 28, y: 38, scale: 0.72, z: 30 },
  qa:          { x: 72, y: 38, scale: 0.72, z: 31 },
  writing:     { x: 25, y: 66, scale: 0.78, z: 42 },
  investment:  { x: 43, y: 69, scale: 0.78, z: 43 },
  data:        { x: 58, y: 68, scale: 0.78, z: 44 },
  engineering: { x: 75, y: 66, scale: 0.80, z: 45 },
};
```

These are default visual slots. A project can map different subagents into these slots.

## Sprite structure

Recommended path:

```text
client/src/assets/fatcat/sprites/
  manager/delegating.png
  research/inspecting.png
  writing/writing.png
  investment/reviewing.png
  data/analysing.png
  engineering/typing.png
  qa/checking.png
```

Start with one sprite per archetype. Later add multiple states per archetype.

## Data model

Keep agent state in JSON/config, not in artwork.

```ts
export type AgentVisualState = "idle" | "working" | "thinking" | "verifying" | "blocked" | "done";

export interface OfficeAgentViewModel {
  agent_id: string;
  name: string;
  role: string;
  status: AgentVisualState;
  task?: string;
  progress?: number;
  slot: keyof typeof OFFICE_SEATS;
  archetype: "manager" | "research" | "writing" | "investment" | "data" | "engineering" | "qa";
  color: string;
}
```

Example project mapping:

```json
{
  "project_id": "credit_risk_review",
  "agents": [
    { "agent_id": "policy_checker", "archetype": "qa", "slot": "qa" },
    { "agent_id": "evidence_collector", "archetype": "research", "slot": "research" },
    { "agent_id": "model_validator", "archetype": "data", "slot": "data" }
  ]
}
```

## Component architecture

Recommended components:

```text
SpriteOfficeMode.tsx
  - OfficeFrame
  - IsometricOfficeBackground
  - AgentSpriteLayer
  - AgentSprite
  - AgentStatusTooltip
  - AgentDetailPanel
  - ProjectObjectivePanel
  - ActivityFeed
  - QuickActions
```

The first implementation should add a new experimental `sprite` view without removing existing Board, Sims, Iso or Mission modes.

## Animation rules

Move cats in place only. Do not move them side-to-side around the room.

Use CSS transforms:

```css
@keyframes fatcat-breathe {
  0%, 100% { transform: translate(-50%, -100%) scale(var(--scale)); }
  50% { transform: translate(-50%, calc(-100% - 4px)) scale(var(--scale)); }
}

@keyframes fatcat-working {
  0%, 100% { transform: translate(-50%, -100%) rotate(-0.5deg) scale(var(--scale)); }
  50% { transform: translate(-50%, calc(-100% - 6px)) rotate(0.5deg) scale(var(--scale)); }
}
```

Respect reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  .fatcat-sprite { animation: none !important; }
}
```

## Claude/Codex implementation prompt

```text
Implement a new experimental Sprite Office view in the React/TypeScript app.

Inspect:
- client/src/pages/OfficeDashboard.tsx
- client/src/lib/officeView.ts
- client/src/components/fatcat/IsometricOfficeMode.tsx
- client/src/components/fatcat/MissionControlMode.tsx
- client/src/components/fatcat/shared.tsx
- client/src/lib/fatcatRoster.ts

Create:
- client/src/components/fatcat/SpriteOfficeMode.tsx
- client/src/components/fatcat/spriteOfficeConfig.ts

Wire it into OfficeDashboard as a new experimental view named Sprite Office.

Requirements:
- CSS/SVG dark isometric office background, not a baked full-scene image
- independent transparent sprite assets
- percentage-based seat coordinates
- click a cat to open detail panel
- hover a cat to show compact task/status tooltip
- status-based glow and in-place animation
- support one manager plus project-specific subagents
- avoid hardcoded agent names
- overflow agents go to a bench panel
- reduced-motion friendly
- keep Board as default and do not remove existing modes
```

## Acceptance criteria

- Cats are independent clickable sprites.
- Large painted role boxes are gone.
- Agent state drives animation, glow, tooltip and detail panel.
- Different projects can use different subagent rosters.
- Existing stable modes still work.
- The new view is gated behind Preview until polished.

/**
 * Chat UI catalog — MOVED to the workspace package `@hotelclaw/chat-ui`
 * so the eve runtime (apps/agent) can share it (eve snapshots its agent
 * root; shared code must arrive via node_modules). This shim keeps the
 * historical import path for the web app's existing consumers.
 */
export * from "@hotelclaw/chat-ui";

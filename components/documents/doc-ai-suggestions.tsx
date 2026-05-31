"use client";

/**
 * Suggestion menu for the document editor's AI Toolkit — the items shown in
 * the floating "Ask AI" toolbar's "asking" phase (see `<AiToolbar suggestions>`
 * in `document-editor.tsx`).
 *
 * Each `<AiToolbar.Suggestion>`'s `prompt` is the exact instruction POSTed to
 * `/ai/contextual`; `children` is the visible label. Whether an item rewrites
 * (replace) or generates (insert) is NOT gated here — the backend decides from
 * whether there's a selection. Items grouped "Edit selection" assume a
 * highlight; "Generate" items work from the cursor with no selection.
 *
 * Note: the reviewing-phase actions (Accept / Try again / Discard, or "Insert
 * below" for a Q&A-style response) are hard-coded by Liveblocks and are NOT
 * part of this menu. Free-form prompts come from the floating-toolbar "Ask AI"
 * button and the `/ai` slash command — both call `editor.commands.askAi()`.
 */

import {
  Briefcase,
  ClipboardList,
  Eraser,
  Languages,
  ListChecks,
  Maximize2,
  Megaphone,
  Minimize2,
  PenLine,
  Smile,
  SpellCheck,
  Text,
  Wand2,
} from "lucide-react";
import { AiToolbar } from "@liveblocks/react-tiptap";

const ICON = "size-4";

export function DocAiSuggestions() {
  return (
    <>
      <AiToolbar.SuggestionsLabel>Edit selection</AiToolbar.SuggestionsLabel>
      <AiToolbar.Suggestion
        icon={<Wand2 className={ICON} />}
        prompt="Improve the writing of the selected text. Make it clearer, more concise, and well-structured while preserving its exact meaning, facts, and any names, numbers, room numbers, or times. Return only the rewritten text."
      >
        Improve writing
      </AiToolbar.Suggestion>
      <AiToolbar.Suggestion
        icon={<SpellCheck className={ICON} />}
        prompt="Proofread the selected text and correct all spelling, grammar, and punctuation errors. Do not change the meaning, tone, wording, or formatting beyond what is needed to fix mistakes. Return only the corrected text."
      >
        Fix spelling &amp; grammar
      </AiToolbar.Suggestion>
      <AiToolbar.Suggestion
        icon={<Minimize2 className={ICON} />}
        prompt="Make the selected text shorter and more concise. Cut filler and redundancy while keeping every key instruction, fact, name, number, and deadline. Return only the shortened text."
      >
        Make shorter
      </AiToolbar.Suggestion>
      <AiToolbar.Suggestion
        icon={<Maximize2 className={ICON} />}
        prompt="Expand the selected text with more relevant detail, context, and specifics so it is more thorough and actionable. Do not invent facts, names, numbers, or policies. Return only the expanded text."
      >
        Make longer
      </AiToolbar.Suggestion>
      <AiToolbar.Suggestion
        icon={<Eraser className={ICON} />}
        prompt="Rewrite the selected text in plain, simple language that any staff member, including non-native English speakers, can follow. Use short sentences and common words; avoid jargon. Keep all facts and steps intact. Return only the simplified text."
      >
        Simplify language
      </AiToolbar.Suggestion>
      <AiToolbar.Suggestion
        icon={<ListChecks className={ICON} />}
        prompt="Rewrite the selected text as a clear, numbered list of sequential steps suitable for a standard operating procedure. Each step should be a single imperative action in logical order. Preserve all details, warnings, and conditions. Return only the numbered steps."
      >
        Rewrite as steps
      </AiToolbar.Suggestion>

      <AiToolbar.SuggestionsSeparator />
      <AiToolbar.SuggestionsLabel>Generate</AiToolbar.SuggestionsLabel>
      <AiToolbar.Suggestion
        icon={<Text className={ICON} />}
        prompt="Summarize the selected text into a brief overview that captures the key points, decisions, and any action items. Use concise bullet points where helpful. Return only the summary."
      >
        Summarize
      </AiToolbar.Suggestion>
      <AiToolbar.Suggestion
        icon={<PenLine className={ICON} />}
        prompt="Continue writing from where the document leaves off, matching the existing tone, style, and formatting. Stay on topic and keep it useful for a hotel operations team. Return only the new text to append."
      >
        Continue writing
      </AiToolbar.Suggestion>
      <AiToolbar.Suggestion
        icon={<ClipboardList className={ICON} />}
        prompt="From the document content, draft a clear list of action items as a checklist. For each item include the task and, where stated, the owner and due date. Do not invent owners or dates that are not mentioned. Return only the checklist."
      >
        Draft action items
      </AiToolbar.Suggestion>

      <AiToolbar.SuggestionsSeparator />
      <AiToolbar.SuggestionsLabel>Tone</AiToolbar.SuggestionsLabel>
      <AiToolbar.Suggestion
        icon={<Briefcase className={ICON} />}
        prompt="Rewrite the selected text in a polished, professional tone appropriate for a guest-facing or management-level hotel document. Keep it courteous and precise without being stiff. Preserve all facts and meaning. Return only the rewritten text."
      >
        Make professional
      </AiToolbar.Suggestion>
      <AiToolbar.Suggestion
        icon={<Smile className={ICON} />}
        prompt="Rewrite the selected text in a warm, friendly, casual tone suitable for internal team notes. Keep it clear and respectful. Preserve all facts and meaning. Return only the rewritten text."
      >
        Make casual
      </AiToolbar.Suggestion>
      <AiToolbar.Suggestion
        icon={<Megaphone className={ICON} />}
        prompt="Rewrite the selected text in a confident, direct, and decisive tone. Remove hedging and tentative phrasing while keeping it professional and accurate. Preserve all facts and meaning. Return only the rewritten text."
      >
        Make confident
      </AiToolbar.Suggestion>

      <AiToolbar.SuggestionsSeparator />
      <AiToolbar.SuggestionsLabel>Translate</AiToolbar.SuggestionsLabel>
      <AiToolbar.Suggestion
        icon={<Languages className={ICON} />}
        prompt="Translate the selected text into natural, fluent Spanish suitable for hospitality staff. Preserve formatting, names, numbers, and times exactly. Return only the translated text."
      >
        Spanish
      </AiToolbar.Suggestion>
      <AiToolbar.Suggestion
        icon={<Languages className={ICON} />}
        prompt="Translate the selected text into natural, fluent English suitable for hospitality staff. Preserve formatting, names, numbers, and times exactly. Return only the translated text."
      >
        English
      </AiToolbar.Suggestion>
      <AiToolbar.Suggestion
        icon={<Languages className={ICON} />}
        prompt="Translate the selected text into natural, fluent French suitable for hospitality staff. Preserve formatting, names, numbers, and times exactly. Return only the translated text."
      >
        French
      </AiToolbar.Suggestion>
    </>
  );
}

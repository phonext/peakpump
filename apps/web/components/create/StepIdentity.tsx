"use client";

import { codepointLength } from "@peakpump/shared/validation";
import { Panel } from "@peakpump/ui/Panel";
import { type Dispatch, useId } from "react";
import {
  descriptionIssue,
  nameIssue,
  symbolIssue,
  type CreateAction,
  type CreateState,
} from "@/lib/create-state";
import { ImageCropper } from "./ImageCropper";

// The placeholder form's own control styles, unchanged: text-body is the 16px
// step, which is what stops a phone browser zooming the page on focus.
const FIELD =
  "hairline rounded-pp bg-pp-surface-2 text-pp-text w-full px-3 py-2 text-body outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright";

const LABEL = "text-small font-medium text-pp-text";

// The counter is the client's rule made visible, and that rule counts
// codepoints: the contract counts bytes and phase 2 maps that revert.
// Nothing here rejects a value the codepoint budget accepts.
const COUNTER = "mono text-body text-pp-text-muted md:text-small";

interface StepIdentityProps {
  state: CreateState;
  dispatch: Dispatch<CreateAction>;
}

export function StepIdentity({ state, dispatch }: StepIdentityProps) {
  const { name, symbol, description } = state.identity;

  const nameId = useId();
  const symbolId = useId();
  const descriptionId = useId();
  const nameNoteId = `${nameId}-note`;
  const symbolNoteId = `${symbolId}-note`;
  const descriptionNoteId = `${descriptionId}-note`;

  // One reason per field, straight from the shared schemas: the specific
  // sentence is shown inline, never a generic "invalid input". An empty name or
  // symbol fails its schema, so the verdict is live from the first visit and the
  // Next button carries it — the note under the field is what waits, until the
  // field has been blurred, so a first keystroke in an empty name is not told
  // what it already knows. The flag stays set once raised, so a field revisited
  // after a fix that broke something else is told again rather than going quiet.
  const nameReason = nameIssue(name);
  const symbolReason = symbolIssue(symbol);
  const descriptionReason = descriptionIssue(description);
  const nameShown = state.blurred.name && nameReason !== null;
  const symbolShown = state.blurred.symbol && symbolReason !== null;
  const descriptionShown = state.blurred.description && descriptionReason !== null;

  return (
    <Panel as="section" title="Token" className="max-w-[560px]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={nameId} className={LABEL}>
              Name
            </label>
            <span className={COUNTER}>{codepointLength(name)}/32</span>
          </div>
          <input
            id={nameId}
            name="name"
            type="text"
            autoComplete="off"
            className={`${FIELD} min-h-[44px]`}
            value={name}
            onChange={(event) => dispatch({ type: "set-name", value: event.target.value })}
            onBlur={() => dispatch({ type: "blur", field: "name" })}
            aria-invalid={nameShown}
            aria-describedby={nameShown ? nameNoteId : undefined}
          />
          {nameShown && (
            <p id={nameNoteId} className="text-small text-pp-down">
              {nameReason}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={symbolId} className={LABEL}>
              Symbol
            </label>
            <span className={COUNTER}>{codepointLength(symbol)}/10</span>
          </div>
          {/* The chain accepts capitals and digits only, so every keystroke is
              stored uppercased: what the field shows is what the schema judges,
              and the verdict never contradicts the display. */}
          <input
            id={symbolId}
            name="symbol"
            type="text"
            autoComplete="off"
            spellCheck={false}
            className={`${FIELD} mono min-h-[44px] uppercase`}
            value={symbol}
            onChange={(event) =>
              dispatch({ type: "set-symbol", value: event.target.value.toUpperCase() })
            }
            onBlur={() => dispatch({ type: "blur", field: "symbol" })}
            aria-invalid={symbolShown}
            aria-describedby={symbolShown ? symbolNoteId : undefined}
          />
          {symbolShown && (
            <p id={symbolNoteId} className="text-small text-pp-down">
              {symbolReason}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={descriptionId} className={LABEL}>
              Description (optional)
            </label>
            <span className={COUNTER}>{codepointLength(description)}/500</span>
          </div>
          <textarea
            id={descriptionId}
            name="description"
            rows={4}
            className={FIELD}
            value={description}
            onChange={(event) => dispatch({ type: "set-description", value: event.target.value })}
            onBlur={() => dispatch({ type: "blur", field: "description" })}
            aria-invalid={descriptionShown}
            aria-describedby={descriptionShown ? descriptionNoteId : undefined}
          />
          {descriptionShown && (
            <p id={descriptionNoteId} className="text-small text-pp-down">
              {descriptionReason}
            </p>
          )}
        </div>

        <ImageCropper image={state.identity.image} dispatch={dispatch} />
      </div>
    </Panel>
  );
}

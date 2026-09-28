"use client";

import { Button } from "@peakpump/ui/Button";
import { useReducer } from "react";
import { useMaxDevBuy } from "@/hooks/useMaxDevBuy";
import {
  CREATE_STEPS,
  createReducer,
  customIssue,
  economicsReason,
  economicsTriple,
  identityIssue,
  initialCreateState,
  type CreateStep,
} from "@/lib/create-state";
import { StepEconomics } from "./StepEconomics";
import { StepIdentity } from "./StepIdentity";
import { StepReview } from "./StepReview";

// The stepper renders from CREATE_STEPS so the visible steps can never drift
// from the union the reducer moves through.
const STEP_LABELS: Record<CreateStep, string> = {
  identity: "Identity",
  economics: "Economics",
  review: "Review",
};

export function CreateFlow() {
  // The initial state is a factory, so it goes in useReducer's lazy third
  // argument rather than being rebuilt and thrown away on every render.
  const [state, dispatch] = useReducer(createReducer, undefined, initialCreateState);

  // maxDevBuy6 derives the triple internally and reverts on an out-of-bounds one
  // (PeakpumpFactory.sol:343), so the container asks only once the model itself
  // has accepted the economics. Preset values are in bounds by construction and
  // customIssue is the model's acceptance of custom values — a raw custom triple
  // here would ask a question the model already knows reverts.
  const triple = customIssue(state) === null ? economicsTriple(state) : null;
  const maxDevBuy = useMaxDevBuy(triple);

  const stepIndex = CREATE_STEPS.indexOf(state.step);

  const nextStep: CreateStep | null =
    state.step === "identity" ? "economics" : state.step === "economics" ? "review" : null;
  const previousStep: CreateStep | null =
    state.step === "economics" ? "identity" : state.step === "review" ? "economics" : null;

  // The model's own reasons gate the edges. The live dev-buy cap is not in this
  // gate: it moves with every poll of the factory view, and the economics step
  // shows it as a sentence at the point of use instead.
  const canAdvance =
    state.step === "identity"
      ? identityIssue(state) === null
      : state.step === "economics"
        ? economicsReason(state) === null
        : false;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title font-medium text-pp-text">Create a token</h1>

      {/* Non-interactive by design: the footer buttons are the only navigation,
          so no step is a link and nothing here is focusable. */}
      <ol className="flex flex-wrap items-center gap-2 text-small">
        {CREATE_STEPS.map((step, index) => (
          <li
            key={step}
            aria-current={step === state.step ? "step" : undefined}
            className={
              step === state.step
                ? "font-medium text-pp-text"
                : index < stepIndex
                  ? "text-pp-text-muted"
                  : "text-pp-text-faint"
            }
          >
            {index > 0 && (
              <span aria-hidden="true" className="mr-2 text-pp-text-faint">
                /
              </span>
            )}
            {STEP_LABELS[step]}
          </li>
        ))}
      </ol>

      {state.step === "identity" && <StepIdentity state={state} dispatch={dispatch} />}
      {state.step === "economics" && (
        <StepEconomics state={state} dispatch={dispatch} maxDevBuy={maxDevBuy} />
      )}
      {state.step === "review" && <StepReview state={state} maxDevBuy={maxDevBuy} />}

      {/* No form element anywhere in the flow: Step 3's submit is a button-driven
          async sequence — a metadata request, then a signature — and a native
          submit would fire it twice. Both navigation buttons are type="button"
          on top of that. ml-auto rather than justify-between, so Next keeps the
          right edge on the first step where Back is absent. */}
      <div className="flex max-w-[560px] items-center">
        {previousStep !== null && (
          <Button
            variant="secondary"
            type="button"
            onClick={() => dispatch({ type: "go-to-step", step: previousStep })}
          >
            Back
          </Button>
        )}
        {nextStep !== null && (
          <Button
            className="ml-auto"
            variant="primary"
            type="button"
            disabled={!canAdvance}
            onClick={() => dispatch({ type: "go-to-step", step: nextStep })}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

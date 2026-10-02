"use client";

import React from "react";

export interface ModeToggleOption<T extends string> {
  value: T;
  label: string;
  /**
   * A Vanilla icon class — verify it exists in `node_modules/vanilla-framework/scss` before adding
   * one. Optional: the question card's tabs are labels alone, the dashboard's carry one each.
   */
  icon?: string;
  /**
   * Why this half cannot be picked right now, or undefined when it can. Shown as the title, and
   * ignored on the half that is already selected — leaving the current mode is never what is being
   * refused.
   */
  disabledReason?: string;
}

interface Props<T extends string> {
  options: readonly ModeToggleOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** The control carries no visible label of its own, so this is what names the group. */
  ariaLabel: string;
  /** Width, placement and bar colour belong to the caller — see `.underline-tabs` in `globals.scss`. */
  className?: string;
}

/**
 * A two-way mode switch, drawn as underline tabs: plain labels side by side, the selected one carrying
 * a thick bar beneath it.
 *
 * One component for both switches — the dashboard's Cards/List and the question card's AI/Edited — so
 * the behaviour cannot drift: they share the option mapping, the `aria-pressed` state and the refusal
 * to leave a mode whose other half has a `disabledReason`. All of the styling is in `.underline-tabs`,
 * and the bar's colour is a custom property a caller can re-point (the dashboard's is brand orange).
 *
 * Note what is deliberately *not* emitted: no `p-button--*` and no `p-segmented-control*` class. Those
 * are what bring a fill, a border, joined edges and rounding, and they set their colours per state at
 * up to 0,2,1. Not emitting the class is how you are rid of styling you do not want — out-specifying
 * it is not. What is left to undo is only what Vanilla puts on a bare `button` element, which
 * `.underline-tabs` documents.
 */
export default function ModeToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: Props<T>) {
  return (
    <div className={`underline-tabs${className ? ` ${className}` : ""}`}>
      <div className="underline-tabs__list" role="group" aria-label={ariaLabel}>
        {options.map((option) => {
          const active = option.value === value;
          const disabled = !active && option.disabledReason !== undefined;
          return (
            <button
              key={option.value}
              type="button"
              // Stopped because a toggle may sit inside a card whose own click expands or collapses
              // it; picking a mode is not a click on the thing behind it.
              onClick={(e) => {
                e.stopPropagation();
                onChange(option.value);
              }}
              disabled={disabled}
              title={disabled ? option.disabledReason : undefined}
              aria-pressed={active}
              className={`underline-tabs__tab${active ? " is-active" : ""}`}
            >
              {/* The gap to the label is a margin in `.underline-tabs`, not a space in the markup: a
                  whitespace-only run between two flex items is not rendered, and these buttons are
                  flex items of the list. Vanilla's own icon margins do not apply here — it hangs them
                  off `%vf-button-has-icon`, which only `.p-button*` and segmented buttons extend. */}
              {option.icon !== undefined && <i className={option.icon} aria-hidden></i>}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

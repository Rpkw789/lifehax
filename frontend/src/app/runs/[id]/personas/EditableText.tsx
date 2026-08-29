"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./personas.module.css";

/**
 * Text that becomes an input when you click it.
 *
 * Click to edit, blur or ⌘/Ctrl+Enter to commit, Escape to abandon. An empty
 * commit is a revert rather than an empty brief: a shopper with nothing to say
 * would make the run measure nothing, so the generated text comes back.
 */
export function EditableText({
  value,
  edited,
  multiline = false,
  disabled = false,
  className = "",
  label,
  onCommit,
  onRevert,
}: {
  value: string;
  /** True when this is the user's text rather than the generator's. */
  edited: boolean;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
  /** For screen readers, since the control is otherwise just text. */
  label: string;
  onCommit: (next: string) => void;
  onRevert: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const field = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  // Escape unmounts the field, and removing a focused element fires blur in
  // some browsers — without this the abandoned draft would commit on the way
  // out, which is the opposite of what Escape means.
  const abandoned = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (abandoned.current) {
      abandoned.current = false;
      setDraft(value);
      return;
    }
    const next = draft.trim();
    if (next === value.trim()) return;
    if (next === "") onRevert();
    else onCommit(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      abandoned.current = true;
      setDraft(value);
      setEditing(false);
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !multiline)) {
      e.preventDefault();
      commit();
    }
  };

  if (editing) {
    const shared = {
      className: `${styles.field} ${className}`,
      value: draft,
      "aria-label": label,
      onBlur: commit,
      onKeyDown,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) =>
        setDraft(e.target.value),
    };
    return multiline ? (
      <textarea
        {...shared}
        rows={3}
        ref={field as React.Ref<HTMLTextAreaElement>}
      />
    ) : (
      <input {...shared} ref={field as React.Ref<HTMLInputElement>} />
    );
  }

  return (
    <span className={styles.editable}>
      <button
        type="button"
        className={`${styles.text} ${className}`}
        disabled={disabled}
        title={disabled ? "enter a store URL to edit the population" : "click to edit"}
        onClick={() => setEditing(true)}
      >
        {value}
      </button>
      {edited && (
        <button
          type="button"
          className={styles.revert}
          onClick={onRevert}
          title="restore what the generator wrote"
        >
          edited · reset
        </button>
      )}
    </span>
  );
}

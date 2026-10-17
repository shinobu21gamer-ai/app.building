"use client";

import { useEffect } from "react";

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function hasRequiredMarker(form: HTMLFormElement, control: FormControl): boolean {
  if (control.required || control.getAttribute("aria-required") === "true") return true;
  if (!control.id) return false;
  return Array.from(form.querySelectorAll<HTMLLabelElement>("label[for]")).some(
    (label) =>
      label.htmlFor === control.id &&
      Boolean(label.querySelector('[aria-label="Required"], [title="Required"]'))
  );
}

function isMissingRequiredValue(control: FormControl, form: HTMLFormElement): boolean {
  if (!hasRequiredMarker(form, control) || control.disabled) return false;
  if (control instanceof HTMLInputElement) {
    if (control.type === "checkbox" || control.type === "radio") return !control.checked;
    if (control.type === "file") return control.files?.length === 0;
  }
  return control.value.trim() === "";
}

function hasLinkedError(control: FormControl): boolean {
  if (control.getAttribute("aria-invalid") === "true") return true;
  const ids = control.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
  return ids.some((id) => document.getElementById(id)?.getAttribute("role") === "alert");
}

function focusFirstInvalid(form: HTMLFormElement): boolean {
  const controls = Array.from(
    form.querySelectorAll<FormControl>("input, select, textarea")
  );
  const invalid = controls.find(
    (control) => hasLinkedError(control) || isMissingRequiredValue(control, form)
  );
  if (!invalid) return false;

  const focusTargetId = invalid.dataset.focusTarget;
  const target = (focusTargetId ? document.getElementById(focusTargetId) : null) ?? invalid;
  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
  target.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "nearest" });
  return true;
}

/**
 * Global form affordance: native and custom validation both take the user to
 * the first missing/invalid control, including errors returned asynchronously
 * by an API after the submit handler has already run.
 */
export function FormFocusAssist() {
  useEffect(() => {
    const pending = new WeakSet<HTMLFormElement>();
    const expireTimers = new WeakMap<HTMLFormElement, number>();

    function markPending(form: HTMLFormElement) {
      pending.add(form);
      const oldTimer = expireTimers.get(form);
      if (oldTimer !== undefined) window.clearTimeout(oldTimer);
      expireTimers.set(form, window.setTimeout(() => pending.delete(form), 30_000));
    }

    function focusWhenReady(form: HTMLFormElement) {
      if (!pending.has(form)) return;
      requestAnimationFrame(() => {
        if (pending.has(form) && focusFirstInvalid(form)) pending.delete(form);
      });
    }

    function onSubmit(event: Event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      markPending(form);
      focusWhenReady(form);
    }

    function onInvalid(event: Event) {
      const control = event.target;
      if (!(control instanceof HTMLElement)) return;
      const form = control.closest("form");
      if (!form) return;
      markPending(form);
      focusWhenReady(form);
    }

    const observer = new MutationObserver((records) => {
      const forms = new Set<HTMLFormElement>();
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : null;
        const form = target?.closest("form");
        if (form instanceof HTMLFormElement) forms.add(form);
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const addedForm = node.closest("form");
          if (addedForm instanceof HTMLFormElement) forms.add(addedForm);
          node.querySelectorAll("form").forEach((child) => {
            if (child instanceof HTMLFormElement) forms.add(child);
          });
        }
      }
      forms.forEach(focusWhenReady);
    });

    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("invalid", onInvalid, true);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-invalid", "aria-describedby"],
    });

    return () => {
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("invalid", onInvalid, true);
      observer.disconnect();
    };
  }, []);

  return null;
}

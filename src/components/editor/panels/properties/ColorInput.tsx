"use client";

export interface ColorInputProps {
  value: string;
  onCommit: (next: string) => void;
  label?: string;
}

/**
 * A color picker using the browser's native <input type="color">.
 * Emits the hex string (always #RRGGBB) via onCommit on every change.
 * The schema enforces #[0-9a-fA-F]{6} — we normalise to lowercase here.
 */
export function ColorInput({ value, onCommit, label }: ColorInputProps) {
  // Normalise value to lowercase hex so the input always gets a valid string.
  // The schema allows uppercase A-F; the HTML color input always returns lowercase.
  const normValue = value.length === 7 ? value.toLowerCase() : "#ffffff";

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onCommit(e.target.value.toLowerCase());
  }

  return (
    <div className="flex items-center gap-2">
      {label && (
        <label className="text-xs text-zinc-400 shrink-0">{label}</label>
      )}
      <input
        type="color"
        value={normValue}
        onChange={handleChange}
        aria-label={label ?? "Color"}
        className="w-7 h-7 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5"
      />
      <span className="text-xs font-mono text-zinc-400">{normValue}</span>
    </div>
  );
}

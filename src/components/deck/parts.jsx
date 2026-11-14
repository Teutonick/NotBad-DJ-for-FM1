// Piezas de las cajas de herramientas del deck: la caja con su etiqueta, el
// sub-grupo, la etiqueta diminuta y el editor de nombre de cues y loops.
import { CUE_NAME_MAX } from "../../lib/constants";

// Caja de herramientas dentro de una pestaña: etiqueta pequeña + sus botones.
// Cada pestaña agrupa dos o tres de estas.
export function Group({ label, className = "", children }) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900/40 px-1.5 py-1 min-w-0 ${className}`}
    >
      <Tiny className="text-[9px]">{label}</Tiny>
      {/* flex-1 + items-center: en una pestaña con cajas de distinto alto, las
          bajitas centran sus botones en vez de quedarse pegadas arriba */}
      <div className="flex flex-1 items-center gap-1">{children}</div>
    </div>
  );
}

// Sub-grupo dentro de una caja: una etiqueta diminuta sobre su fila de botones
export function Cluster({ label, title, children }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0" title={title}>
      <Tiny className="text-[8px]">{label}</Tiny>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  );
}

// Etiqueta de caja. El truco de width:0 + minWidth:100% hace que NO cuente
// para el ancho intrínseco: así una traducción larga no ensancha la caja ni
// mueve el resto de la interfaz al cambiar de idioma.
export function Tiny({ className = "", children }) {
  return (
    <span
      className={`uppercase tracking-wide text-neutral-500 truncate ${className}`}
      style={{ width: 0, minWidth: "100%" }}
    >
      {children}
    </span>
  );
}

// Editor de etiqueta de un cue o de un loop guardado. Va FLOTANDO sobre su
// caja (absolute), así abrirlo no empuja el resto de la interfaz.
// Enter confirma, Esc cancela.
export function NameEditor({
  label,
  value,
  placeholder,
  okTitle,
  cancelTitle,
  onChange,
  onCommit,
  onCancel,
}) {
  return (
    <div className="absolute left-0 top-full z-20 mt-1 flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl">
      <span className="text-[9px] whitespace-nowrap text-neutral-400">
        {label}
      </span>
      <input
        autoFocus
        value={value}
        maxLength={CUE_NAME_MAX}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") onCommit();
          else if (e.key === "Escape") onCancel();
        }}
        className="w-24 rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-[11px]"
      />
      <button
        onClick={onCommit}
        title={okTitle}
        className="w-6 h-6 shrink-0 grid place-items-center rounded border border-emerald-500/60 bg-emerald-500/20 text-[11px] text-emerald-300"
      >
        ✓
      </button>
      <button
        onClick={onCancel}
        title={cancelTitle}
        className="w-6 h-6 shrink-0 grid place-items-center rounded border border-neutral-700 bg-neutral-800 text-[11px] text-neutral-300"
      >
        ✕
      </button>
    </div>
  );
}

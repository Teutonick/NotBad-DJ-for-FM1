import PadButton from "../PadButton";

// Los cuatro botones de ajuste « ‹ › »: atrás grueso, atrás fino, adelante
// fino y adelante grueso. Cada uno llama a `onStep` con su paso, con signo.
// Devuelve solo los botones (sin envoltorio), para que vayan en la fila o en
// el `Cluster` que los contenga.
// `titles` y `labels` van en ese mismo orden; `coarseClassName` se aplica solo
// a los dos gruesos (el «−−» y el «++» del tempo van más apretados).
export default function StepRow({
  onStep,
  fine,
  coarse,
  disabled,
  titles,
  labels = ["«", "‹", "›", "»"],
  coarseClassName,
}) {
  const steps = [-coarse, -fine, fine, coarse];
  return (
    <>
      {steps.map((step, i) => (
        <PadButton
          key={i}
          onClick={() => onStep(step)}
          disabled={disabled}
          title={titles[i]}
          className={i === 0 || i === 3 ? coarseClassName : undefined}
        >
          {labels[i]}
        </PadButton>
      ))}
    </>
  );
}

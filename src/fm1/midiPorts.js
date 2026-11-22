const fm1Name = /fm[ -]?1 dj\b/i;
const normalize = (value) => (value || "").trim().toLowerCase();
const bareName = (value) => normalize(value).replace(/\s+\d+$/, "");
const only = (items) => (items.length === 1 ? items[0] : undefined);

export function selectInput(ports, selected) {
  if (selected) return ports.find((port) => port.id === selected);
  return only(ports.filter((port) => fm1Name.test(port.name || "")));
}

export function selectOutput(ports, input, selected) {
  if (!input) return;
  if (selected) return ports.find((port) => port.id === selected);
  if (!fm1Name.test(input.name || "")) return;
  const manufacturer = normalize(input.manufacturer);
  const candidates = ports.filter((port) => {
    const maker = normalize(port.manufacturer);
    return (
      (!maker || !manufacturer || maker === manufacturer) &&
      bareName(port.name) === bareName(input.name)
    );
  });
  return (
    only(
      candidates.filter(
        (port) => normalize(port.name) === normalize(input.name),
      ),
    ) || only(candidates)
  );
}

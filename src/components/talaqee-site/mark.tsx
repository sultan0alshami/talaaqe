export function InfameMark({ width = 36, height = 35 }: { width?: number; height?: number }) {
  return <span aria-hidden="true" style={{ width, height, borderRadius: "50%", border: "5px solid #121214", background: "#fffc00", display: "inline-block", flexShrink: 0 }} />;
}

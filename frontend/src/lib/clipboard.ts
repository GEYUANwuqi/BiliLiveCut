/** Copy text during a user action, including plain HTTP LAN deployments. */
export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      /* Try the browser's selection-based fallback. */
    }
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  try {
    if (!document.execCommand("copy"))
      throw new Error("当前浏览器无法复制，请手动复制文本");
  } finally {
    input.remove();
  }
}

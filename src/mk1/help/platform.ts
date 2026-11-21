export type Os = "mac" | "windows" | "linux" | "chromeos" | "android" | "ios" | "other";

export function detectOs(): Os {
  const ua = navigator.userAgent.toLowerCase();
  const hint = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const platform = (hint || navigator.platform || "").toLowerCase();
  if (/iphone|ipad|ipod/.test(ua) || (platform.includes("mac") && navigator.maxTouchPoints > 1)) return "ios";
  if (ua.includes("android")) return "android";
  if (platform.includes("mac")) return "mac";
  if (platform.includes("win")) return "windows";
  if (ua.includes("cros")) return "chromeos";
  if (platform.includes("linux")) return "linux";
  return "other";
}

/** a computer we can give terminal steps for */
export type Desk = "mac" | "linux" | "windows";
export const deskOf = (os: Os): Desk => (os === "windows" ? "windows" : os === "linux" || os === "chromeos" ? "linux" : "mac");

export const usbTrouble = () => !window.isSecureContext || !("usb" in navigator);

/** Firefox has Web Serial on computers from 151 on, and the first time a site asks for a port it offers a
 *  "site permission add-on" before the port list; it has no WebUSB */
export const isFirefox = () => /firefox\//i.test(navigator.userAgent);

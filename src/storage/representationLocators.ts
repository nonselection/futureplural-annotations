/** Lexical confinement guard only; real host alias/normalization qualification belongs to S4. */
export function isSafeRepresentationLocator(locator: string, allowRoot = false): boolean {
    if (typeof locator !== "string" || locator.includes("\0") || locator.includes("\\")) return false;
    if (allowRoot && locator === "") return true;
    if (!locator || locator.startsWith("/") || locator.endsWith("/")) return false;
    return locator.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Deterministic JSON-compatible encoding and SHA-256 digest helpers. */

declare const canonicalDigestBrand: unique symbol;

export type CanonicalDigest = string & { readonly [canonicalDigestBrand]: true };

export class CanonicalEncodingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CanonicalEncodingError";
    }
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function fail(path: string, message: string): never {
    throw new CanonicalEncodingError(`${path}: ${message}`);
}

function canonicalize(value: unknown, path: string, ancestors: Set<object>, depth: number): string {
    if (depth > 512) fail(path, "maximum canonical JSON depth exceeded");
    if (value === null) return "null";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
        if (
            !Number.isFinite(value) ||
            Object.is(value, -0) ||
            (Number.isInteger(value) && !Number.isSafeInteger(value))
        ) {
            fail(path, "non-finite numbers, unsafe integers, and negative zero are not canonical JSON values");
        }
        return JSON.stringify(value);
    }
    if (typeof value !== "object") {
        fail(path, `unsupported JSON value type ${typeof value}`);
    }

    const objectValue = value;
    if (ancestors.has(objectValue)) fail(path, "cyclic values are not canonical JSON");
    ancestors.add(objectValue);
    try {
        if (Array.isArray(value)) return canonicalizeArray(value, path, ancestors, depth);
        return canonicalizeObject(value as Record<string, unknown>, path, ancestors, depth);
    } catch (error) {
        if (error instanceof CanonicalEncodingError) throw error;
        fail(path, "could not safely inspect value");
    } finally {
        ancestors.delete(objectValue);
    }
}

function canonicalizeArray(value: unknown[], path: string, ancestors: Set<object>, depth: number): string {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(path, "array must use the standard array prototype");

    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string")) {
        fail(path, "arrays with extra or symbol properties are not canonical JSON");
    }

    const elements: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            fail(`${path}[${index}]`, "sparse arrays and accessor elements are not canonical JSON");
        }
        elements.push(canonicalize(descriptor.value, `${path}[${index}]`, ancestors, depth + 1));
    }
    return `[${elements.join(",")}]`;
}

function canonicalizeObject(
    value: Record<string, unknown>,
    path: string,
    ancestors: Set<object>,
    depth: number
): string {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        fail(path, "only plain objects are canonical JSON values");
    }

    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) fail(path, "symbol properties are not canonical JSON");
    const stringKeys = (keys as string[]).sort();
    const fields: string[] = [];
    for (const key of stringKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            fail(`${path}.${key}`, "non-enumerable and accessor properties are not canonical JSON");
        }
        fields.push(`${JSON.stringify(key)}:${canonicalize(descriptor.value, `${path}.${key}`, ancestors, depth + 1)}`);
    }
    return `{${fields.join(",")}}`;
}

export function canonicalSerialize(value: unknown): string {
    return canonicalize(value, "$", new Set<object>(), 0);
}

export function isCanonicalDigest(value: unknown): value is CanonicalDigest {
    return typeof value === "string" && DIGEST_PATTERN.test(value);
}

export async function sha256Bytes(value: Uint8Array): Promise<CanonicalDigest> {
    const cryptoApi = window.crypto;
    if (!cryptoApi?.subtle) {
        throw new CanonicalEncodingError("Web Crypto SHA-256 is unavailable on this runtime.");
    }

    const input = Uint8Array.from(value);
    const digest = await cryptoApi.subtle.digest("SHA-256", input.buffer);
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `sha256:${hex}` as CanonicalDigest;
}

export async function canonicalDigest(value: unknown): Promise<CanonicalDigest> {
    const encoder = window.TextEncoder;
    if (typeof encoder !== "function") {
        throw new CanonicalEncodingError("TextEncoder is unavailable on this runtime.");
    }
    return sha256Bytes(new encoder().encode(canonicalSerialize(value)));
}

export function digestsEqual(left: CanonicalDigest, right: CanonicalDigest): boolean {
    return left === right;
}

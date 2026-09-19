import { describe, expect, it, vi } from "vitest";
import { createRoughNotationConfig, RoughNotationRenderer } from "../src/core/RoughNotationRenderer";
import { createObsidianWindow } from "./dom-helpers.js";

function fakeAnnotation() {
    return {
        show: vi.fn(),
        hide: vi.fn(),
        remove: vi.fn(),
        isShowing: vi.fn(() => true),
    };
}

function waitForAnimationFrame(window) {
    return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

describe("Rough Notation renderer", () => {
    it("maps FuturePlural metadata to a non-animated multiline annotation", () => {
        const window = createObsidianWindow();
        const mark = window.document.createElement("mark");
        mark.dataset.fpNotation = "underline";
        mark.dataset.fpColor = "#8fa58f";

        expect(createRoughNotationConfig(mark)).toEqual({
            type: "underline",
            color: "#8fa58f",
            animate: false,
            multiline: true,
        });
    });

    it("renders FuturePlural and legacy marks after layout, then removes every annotation on unload", async () => {
        const window = createObsidianWindow();
        const container = window.document.getElementById("content");
        container.innerHTML = [
            '<p><mark data-fp-notation="circle" data-fp-color="#8fa58f">Future</mark></p>',
            '<p><mark style="background-color: rgb(255, 204, 102)">Legacy</mark></p>',
        ].join("");

        const annotations = [];
        const annotateElement = vi.fn((_element, _config) => {
            const annotation = fakeAnnotation();
            annotations.push(annotation);
            return annotation;
        });
        const renderer = new RoughNotationRenderer(container, annotateElement);

        renderer.onload();
        expect(annotateElement).not.toHaveBeenCalled();

        await waitForAnimationFrame(window);

        expect(annotateElement).toHaveBeenCalledTimes(2);
        expect(annotateElement.mock.calls[0][1]).toMatchObject({
            type: "circle",
            color: "#8fa58f",
        });
        expect(annotateElement.mock.calls[1][1]).toMatchObject({
            type: "highlight",
            color: "rgb(255, 204, 102)",
        });
        expect(annotations.every((annotation) => annotation.show.mock.calls.length === 1)).toBe(true);
        expect(container.querySelectorAll("mark.fp-rough-notation-target")).toHaveLength(2);

        renderer.onunload();

        expect(annotations.every((annotation) => annotation.remove.mock.calls.length === 1)).toBe(true);
        expect(container.querySelectorAll("mark.fp-rough-notation-target")).toHaveLength(0);
    });

    it("does not attach a second annotation to an active target", async () => {
        const window = createObsidianWindow();
        const container = window.document.getElementById("content");
        container.innerHTML = '<p><mark data-fp-notation="box">Once</mark></p>';

        const firstAnnotate = vi.fn(() => fakeAnnotation());
        const secondAnnotate = vi.fn(() => fakeAnnotation());
        const first = new RoughNotationRenderer(container, firstAnnotate);
        const second = new RoughNotationRenderer(container, secondAnnotate);

        first.onload();
        second.onload();

        await waitForAnimationFrame(window);

        expect(firstAnnotate).toHaveBeenCalledTimes(1);
        expect(secondAnnotate).not.toHaveBeenCalled();

        second.onunload();
        first.onunload();
    });

    it("ignores empty marks", async () => {
        const window = createObsidianWindow();
        const container = window.document.getElementById("content");
        container.innerHTML = "<mark>   </mark>";
        const annotateElement = vi.fn(() => fakeAnnotation());

        const renderer = new RoughNotationRenderer(container, annotateElement);
        renderer.onload();

        await waitForAnimationFrame(window);

        expect(annotateElement).not.toHaveBeenCalled();
    });

    it("cancels deferred rendering when its Markdown section unloads", async () => {
        const window = createObsidianWindow();
        const container = window.document.getElementById("content");
        container.innerHTML = "<mark>Unloaded</mark>";
        const annotateElement = vi.fn(() => fakeAnnotation());

        const renderer = new RoughNotationRenderer(container, annotateElement);
        renderer.onload();
        renderer.onunload();

        await waitForAnimationFrame(window);

        expect(annotateElement).not.toHaveBeenCalled();
    });
});

// Runtime stub for the `obsidian` module, which ships types only. Enough
// surface for plugin classes to be constructed and their methods called from
// Node, so UI and selection code can be tested as written.

import { JSDOM } from "jsdom";

export function sanitizeHTMLToDom(html) {
    const document = new JSDOM(`<body>${html}</body>`).window.document;
    const fragment = document.createDocumentFragment();
    while (document.body.firstChild) fragment.appendChild(document.body.firstChild);
    return fragment;
}

export class Events {
    on() {}
    off() {}
    trigger() {}
}
export class Component extends Events {
    load() {}
    unload() {}
    addChild(c) {
        return c;
    }
    registerDomEvent(el, type, handler, options) {
        el.addEventListener(type, handler, options);
        return handler;
    }
    registerEvent() {}
    registerInterval() {}
}
export class MarkdownRenderChild extends Component {
    constructor(containerEl) {
        super();
        this.containerEl = containerEl;
    }
}
export class Plugin extends Component {
    constructor(app, manifest) {
        super();
        this.app = app;
        this.manifest = manifest;
    }
    addCommand() {}
    addRibbonIcon() {
        return { addClass() {} };
    }
    addSettingTab() {}
    registerView() {}
    registerMarkdownPostProcessor() {}
    async loadData() {
        return {};
    }
    async saveData() {}
}
export class View extends Component {}
export class ItemView extends View {}
export class MarkdownView extends View {}
export class Modal extends Component {}
export class Menu {
    setUseNativeMenu() {
        return this;
    }
    setParentElement(element) {
        this.parentElement = element;
        return this;
    }
    onHide(callback) {
        this.onHideCallback = callback;
        return this;
    }
    addItem(callback) {
        const item = new MenuItem();
        callback(item);
        return this;
    }
    addSeparator() {
        return this;
    }
    showAtMouseEvent() {}
    hide() {
        this.onHideCallback?.();
        return this;
    }
}
export class MenuItem {
    setTitle() {
        return this;
    }
    setIcon() {
        return this;
    }
    setWarning() {
        return this;
    }
    setIsLabel() {
        return this;
    }
    onClick(callback) {
        this.callback = callback;
        return this;
    }
}
export class PluginSettingTab extends Component {}
export class Setting {
    setName() {
        return this;
    }
    setDesc() {
        return this;
    }
    addText() {
        return this;
    }
    addToggle() {
        return this;
    }
    addButton() {
        return this;
    }
    addDropdown() {
        return this;
    }
}
export class TextAreaComponent {}
export class WorkspaceLeaf {}
export class TFile {
    constructor(path = "note.md") {
        this.path = path;
        this.basename = path.replace(/\.md$/, "");
        this.extension = "md";
    }
}
export class Notice {
    constructor(message) {
        Notice.messages.push(String(message));
    }
}
Notice.messages = [];

export const Platform = { isMobile: false, isDesktop: true, isIosApp: false };
export function setIcon() {}
export function setTooltip(el, tooltip, options = {}) {
    el.dataset.testTooltip = tooltip;
    el.dataset.testTooltipPlacement = options.placement || "";
}
export async function loadPdfJs() {
    return {};
}

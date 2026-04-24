import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// comfy-file-inputにmp4を追加
const _slimyFileInput = document.getElementById("comfy-file-input");
if (_slimyFileInput && !_slimyFileInput._slimyMp4Added) {
    _slimyFileInput.accept += ",video/mp4";
    _slimyFileInput._slimyMp4Added = true;
}



app.registerExtension({
    name: "Slimy.LoadImageSpy",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Slimy_LoadImageSpy") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            console.log("[Slimy] onNodeCreated called");

            const self = this;
            let metaVisible = true;
            let wfWidgetRef = null;


//ワークフローがなければグレーアウト
const setWfEnabled = (enabled) => {
    if (wfWidgetRef) {
        wfWidgetRef.name = enabled ? "🕵️ Open Workflow" : "🚫 No Metadata";
        wfWidgetRef.disabled = !enabled;
    }
};



            const ensureOrder = () => {
                const find = (name) => self.widgets?.find(w => w.name === name);
                const imageWidget   = find("image");
                const uploadWidget  = find("upload");
                const mp4Widget     = find("📂 Choose Image to Upload");
                const previewWidget = find("$$canvas-image-preview");
                const toggleWidget  = self.widgets?.find(w => w.name === "🔍 Hide Prompt" || w.name === "🔍 Show Prompt");
                const wfWidget      = self.widgets?.find(w => w.name === "🕵️ Open Workflow" || w.name === "🚫 No Metadata");
                const metaWidget    = find("meta_prompt");

                // 揃っていないものがあればスキップ
                if (!imageWidget || !metaWidget) return;

                // 順番通りに並べ直す
                const ordered = [
                    imageWidget,
                    uploadWidget,
                    mp4Widget,
                    previewWidget,
                    toggleWidget,
                    wfWidget,
                    metaWidget,
                ].filter(Boolean);

                // orderedに含まれないウィジェットは末尾に温存
                const rest = self.widgets.filter(w => !ordered.includes(w));
                self.widgets.length = 0;
                self.widgets.push(...ordered, ...rest);

                self.setSize([self.size[0], Math.max(self.size[1], self.computeSize()[1])]);
                self.setDirtyCanvas(true);
            };

            // 後方互換のエイリアス
            const ensureMetaLast = ensureOrder;

            const fetchMeta = async (filename) => {
                const metaWidget = self.widgets?.find(w => w.name === "meta_prompt") || self._slimyHiddenMeta;
                if (!metaWidget) return;
                const noMeta = "no metadata";
                if (!filename) {
                    metaWidget.value = noMeta;
                    if (metaWidget.inputEl) metaWidget.inputEl.value = noMeta;
                    setWfEnabled(false);
                    ensureMetaLast();
                    return;
                }
                try {
                    const res = await fetch(`/slimy/image_meta?filename=${encodeURIComponent(filename)}`);
                    const data = await res.json();
                    const text = data.meta_prompt || noMeta;
                    metaWidget.value = text;
                    if (metaWidget.inputEl) metaWidget.inputEl.value = text;
                    setWfEnabled(!text.startsWith("//////// No Metadata") && text !== "");
                } catch (e) {
                    metaWidget.value = noMeta;
                    if (metaWidget.inputEl) metaWidget.inputEl.value = noMeta;
                    setWfEnabled(false);
                } finally {
                    ensureMetaLast();
                }
            };

            const openWorkflow = async (filename) => {
                if (!filename) return;
                try {
                    const res = await fetch(`/slimy/image_workflow?filename=${encodeURIComponent(filename)}`);
                    const data = await res.json();
                    if (!data.workflow) { alert("No workflow found in this image."); return; }
                    await app.loadGraphData(data.workflow);
                } catch (e) {
                    alert("Failed to open workflow.");
                    console.error("[Slimy_LoadImageSpy] openWorkflow error:", e);
                }
            };

            const init = () => {
                const imageWidget = self.widgets?.find(w => w.name === "image");
                const metaWidget  = self.widgets?.find(w => w.name === "meta_prompt");
                console.log("[Slimy] init called", { imageWidget: !!imageWidget, metaWidget: !!metaWidget });
                if (!imageWidget || !metaWidget) return;



                // アップロードボタンのaccept属性にmp4を追加
                const uploadInput = document.querySelector("input[accept*='image']");
                if (uploadInput && !uploadInput._slimyMp4Patched) {
                    uploadInput.accept = ".png,.jpg,.jpeg,.webp,.gif,.mp4";
                    uploadInput._slimyMp4Patched = true;
                }

                if (!metaWidget._slimyPatched) {
                    // 初回は現在のノードサイズからmetaHを推定
                    if (!self._slimyMetaH) {
                        const TOP_Y = 114;
                        const BUTTON_H = 48;
                        self._slimyMetaH = Math.max(60, (self.size?.[1] ?? 400) - TOP_Y - BUTTON_H - 8);



                    }
                    metaWidget.computeSize = function(width) {
                        if (!metaVisible) return [0, 0];
                        return [width, self._slimyMetaH ?? 60];
                    };
                    metaWidget._slimyPatched = true;
                }



                if (metaWidget.inputEl) {
                    metaWidget.inputEl.readOnly = true;
                    metaWidget.inputEl.style.color = "#aaa";
                    metaWidget.inputEl.style.fontStyle = "italic";

                    // div.dom-widgetを取得して表示制御
                    let domWidget = metaWidget.inputEl;
                    while (domWidget && !domWidget.classList?.contains("dom-widget")) {
                        domWidget = domWidget.parentElement;
                    }
                    if (domWidget) {

                        domWidget.style.pointerEvents = metaVisible ? "auto" : "none";
                        domWidget.style.visibility = metaVisible ? "visible" : "hidden";
                        domWidget.style.clipPath = metaVisible ? "none" : "inset(100%)";
                    }
                }

                if (!self._slimyInited) {
                    // mp4専用アップロードボタンを追加（元のuploadボタンはそのまま）
                    if (!self._slimyMp4WidgetAdded) {
                        const mp4Input = document.createElement("input");
                        mp4Input.type = "file";
                        mp4Input.accept = ".png,.jpg,.jpeg,.webp,.gif,video/mp4,.mp4";
                        mp4Input.style = "display: none";
                        mp4Input.onchange = async () => {
                            const file = mp4Input.files?.[0];
                            if (!file) return;
                            const body = new FormData();
                            const newFile = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
                            body.append("image", newFile);
                            try {
                                const resp = await fetch("/upload/image", { method: "POST", body });
                                if (resp.status === 200) {
                                    const data = await resp.json();
                                    const filename = data.name;
                                    if (!imageWidget.options.values.includes(filename)) {
                                        imageWidget.options.values.push(filename);
                                    }
                                    imageWidget.value = null;
                                    imageWidget.value = filename;
                                    fetchMeta(filename);
                                    imageWidget.callback?.(filename);
                                }
                            } catch(e) {
                                console.error("[Slimy_LoadImageSpy] MP4 upload error:", e);
                            }
                        };
                        document.body.append(mp4Input);
                        // uploadボタンをノード外に追い出して見切れさせる
                        const stdUpload = self.widgets?.find(w => w.name === "upload");
                        if (stdUpload) {
                            stdUpload.computeSize = () => [0, 0];
                            const origDraw = stdUpload.draw?.bind(stdUpload);
                            stdUpload.draw = function(ctx, node, w, y) {
                                // 描画しない
                            };
                        }

                        self.addWidget("button", "📂 Choose Image to Upload", null, () => {
                            app.canvas.node_widget = null;
                            mp4Input.click();
                        });
                        self._slimyMp4WidgetAdded = true;
                    }

                    const toggleWidget = self.addWidget("button", "🔍 Hide Prompt", null, () => {
                        metaVisible = !metaVisible;
                        const mw = self._slimyHiddenMeta || self.widgets?.find(w => w.name === "meta_prompt");
                        if (!mw) return;

                        // div.dom-widget（inputElの親またはその親）を取得
                        const getDomWidget = (el) => {
                            let node = el;
                            while (node) {
                                if (node.classList?.contains("dom-widget")) return node;
                                node = node.parentElement;
                            }
                            return null;
                        };
                        const domWidget = getDomWidget(mw.inputEl);

                        if (metaVisible) {
                            if (!self.widgets.includes(mw)) {
                                self.widgets.push(mw);
                                self._slimyHiddenMeta = null;
                            }
                            if (domWidget) {
                                domWidget.style.pointerEvents = "auto";
                                domWidget.style.visibility = "visible";
                                domWidget.style.clipPath = "none";
                            }
                        } else {
                            const idx = self.widgets.indexOf(mw);
                            if (idx !== -1) self.widgets.splice(idx, 1);
                            self._slimyHiddenMeta = mw;
                            self._slimyMetaH = 0;
                            if (domWidget) {
                                domWidget.style.pointerEvents = "none";
                                domWidget.style.visibility = "hidden";
                                domWidget.style.clipPath = "inset(100%)";
                            }
                        }

                        toggleWidget.name = metaVisible ? "🔍 Hide Prompt" : "🔍 Show Prompt";
                        app.graph.setDirtyCanvas(true, true);
                        requestAnimationFrame(() => app.graph.setDirtyCanvas(true, true));
                    });

                    wfWidgetRef = self.addWidget("button", "🕵️ Open Workflow", null, () => {
                        const mw = self.widgets?.find(w => w.name === "meta_prompt") || self._slimyHiddenMeta;
                        const text = mw?.value || "";
                        if (text === "" || text.startsWith("//////// No Metadata")) return;
                        if (confirm("🕵️ Open this image's workflow in a new tab?")) {
                            openWorkflow(imageWidget.value);
                        }
                    });

                    // $$canvas-image-previewがpushされた瞬間に並び替え＆描画パッチ
                    if (!self.widgets._slimyPushPatched) {
                        const origPush = self.widgets.push.bind(self.widgets);
                        self.widgets.push = function(...args) {
                            const result = origPush(...args);
                            for (const w of args) {
                                if (w?.name === "$$canvas-image-preview" && !w._slimyAlignPatched) {
                                    w.computeLayoutSize = function() {
                                        return { minHeight: 1, minWidth: 1 };
                                    };

                                    w.drawWidget = function(ctx, options) {
                                        const imgs = options.previewImages ?? this.node.imgs ?? [];
                                        const nodeH = self.size?.[1] ?? 500;
                                        const nodeW = options.width;
                                        const sharedH = nodeH - this.y;

                                        //const BUTTON_H = 48;

                                    //ここで文字を出す
                                        const BUTTON_H =65;

///////////////////////////
                                        const maxImgH = metaVisible
                                            ? Math.min(sharedH * 0.6, sharedH - BUTTON_H - 60)
                                            : sharedH - BUTTON_H;




//const MIN_IMG_H = 60; // ← 画像プレビューの最小サイズ（px）を好みで設定
//
//const maxImgH = metaVisible
//    ? Math.max(MIN_IMG_H, Math.min(sharedH * 0.7, sharedH - BUTTON_H - 60))
//    : Math.max(MIN_IMG_H, sharedH - BUTTON_H);

//////////////////////////////

                                        let actualDh = 0;
                                        const currentFile = self.widgets?.find(w => w.name === "image")?.value ?? "";
                                        const isMp4 = currentFile.toLowerCase().endsWith(".mp4");

                                        if (isMp4) {
                                            const ph = maxImgH;
                                            const metaW = self.widgets?.find(w => w.name === "meta_prompt") || self._slimyHiddenMeta;
                                            const metaText = metaW?.value ?? "";
                                            const hasMetadata = metaText && !metaText.startsWith("//////// No Metadata") && metaText !== "no metadata";
                                            const line2 = hasMetadata ? "↓↓↓ Has Metadata ↓↓↓" : "No Metadata";
                                            ctx.save();
                                            ctx.fillStyle = "rgba(255,255,255,0.06)";
                                            ctx.fillRect(0, this.y, nodeW, ph);
                                            ctx.fillStyle = "rgba(255,255,255,0.35)";
                                            ctx.textAlign = "center";
                                            ctx.textBaseline = "middle";
                                            const centerY = this.y + ph / 2;
                                            ctx.font = "14px sans-serif";
                                            ctx.fillText("🎬 MP4", nodeW / 2, centerY - 10);
                                            ctx.font = hasMetadata ? "bold 13px sans-serif" : "13px sans-serif";
                                            ctx.fillStyle = hasMetadata ? "rgba(100,220,100,0.9)" : "rgba(255,255,255,0.35)";
                                            ctx.fillText(line2, nodeW / 2, centerY + 10);
                                            ctx.restore();
                                            actualDh = ph;
                                            w._slimyActualDh = ph;
                                        } else if (imgs.length) {
                                            const img = imgs[0];
                                            if (img?.naturalWidth) {
                                                const aspect = img.naturalHeight / img.naturalWidth;
                                                let dw = nodeW;
                                                let dh = dw * aspect;
                                                if (dh > maxImgH) {
                                                    dh = maxImgH;
                                                    dw = dh / aspect;
                                                }
                                                const x = (nodeW - dw) / 2;
                                                ctx.save();
                                                ctx.drawImage(img, x, this.y, dw, dh);
                                                ctx.restore();
                                                actualDh = dh;
                                                w._slimyActualDh = dh;




////////////////追加//////////////////////

// 解像度テキストを画像とボタンの間に表示
ctx.save();
ctx.fillStyle = "#aaaaaa";
ctx.font = "9px monospace";
ctx.textAlign = "center";
ctx.textBaseline = "middle";
const resText = `${img.naturalWidth} × ${img.naturalHeight} px`;

//const textY = this.y + actualDh + (BUTTON_H / 2);
const textY = this.y + actualDh + 7;

ctx.fillText(resText, nodeW / 2, textY);
ctx.restore();


//////////////////////////////////////////
                                            }
                                        }

                                        // metaHを計算してcomputeSizeから参照（画像がある時だけ更新）
                                        if (actualDh > 0) {
                                            const metaW = self.widgets?.find(w => w.name === "meta_prompt");
                                            if (metaW) {
                                                const btnY = this.y + actualDh;
                                                const metaTop = btnY + BUTTON_H;



                                                const metaH = nodeH - metaTop - 8;


                                                const newMetaH = Math.max(60, Math.round(metaH));
                                                if (self._slimyMetaH !== newMetaH) {
                                                    self._slimyMetaH = newMetaH;
                                                }
                                            }
                                        }
                                    };

                                    w._slimyAlignPatched = true;
                                    ensureMetaLast();
                                }
                            }
                            return result;
                        };
                        self.widgets._slimyPushPatched = true;
                    }

                    let _imageValue = imageWidget.value;
                    Object.defineProperty(imageWidget, "value", {
                        get() { return _imageValue; },
                        set(v) {
                            _imageValue = v;
                            fetchMeta(v);
                        },
                        configurable: true,
                    });
//////////////////////////////
//ノードサイズの最小を定義する

self.onResize = function(size) {
    if (size[1] < 420) size[1] = 420;
};


///////////////////////////////
                    ensureMetaLast();
                    self._slimyInited = true;
                }

                ensureMetaLast();
                fetchMeta(imageWidget.value);
                // 初回ノード生成時にプレビューエリアを確保するためcallbackを呼ぶ
                if (imageWidget.value) {
                    imageWidget.callback?.(imageWidget.value);
                }
            };

            setTimeout(init, 0);

            const origOnConfigure = self.onConfigure;
            self.onConfigure = function (config) {
                origOnConfigure?.call(this, config);
                // 保存されたサイズからmetaHを計算してセット
                if (config.size?.[1]) {
                    const savedH = config.size[1];
                    const TOP_Y = 114;
                    const BUTTON_H = 48;
                    self._slimyMetaH = Math.max(60, savedH - TOP_Y - BUTTON_H - 8);
                }
                Promise.resolve().then(init).then(() => {
                    const imageWidget = self.widgets?.find(w => w.name === "image");
                    if (!imageWidget) return;
                    const curVal = imageWidget.value ?? "";
                    const ismp4OrEmpty = !curVal || curVal.toLowerCase().endsWith(".mp4");
                    if (ismp4OrEmpty) {
                        const imageExts = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
                        const firstImage = imageWidget.options?.values?.find(v =>
                            imageExts.some(ext => v.toLowerCase().endsWith(ext))
                        );
                        if (firstImage) {
                            imageWidget.value = firstImage;
                            // callbackはジョブ実行をトリガーするので使わず、直接プレビューを更新
                            const previewWidget = self.widgets?.find(w => w.name === "$$canvas-image-preview");
                            if (previewWidget) {
                                self.setDirtyCanvas(true);
                            } else {
                                // プレビューウィジェットがない場合はsetterで発火させる
                                const tmp = imageWidget.value;
                                imageWidget.value = null;
                                imageWidget.value = tmp;
                            }
                        }
                    }
                });
            };
        };
    },
});

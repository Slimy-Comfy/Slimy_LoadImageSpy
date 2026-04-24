import numpy as np
import torch
import json
import pathlib
import struct

from aiohttp import web
from PIL import Image, ImageOps, ImageSequence
import node_helpers
import folder_paths
import server


class Slimy_LoadImageSpy:
    """
    標準の LoadImage にメタデータ表示を追加したノード。
    PNGメタデータからプロンプトを抽出し、multilineフィールドに表示する。
    """

    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = [f.name for f in pathlib.Path(input_dir).iterdir() if f.is_file()]
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True, "accept": ".png,.jpg,.jpeg,.webp,.mp4"}),
            },
            "optional": {
                "meta_prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "Extracted prompt metadata from the image.",
                }),
            },
        }


    CATEGORY = "Slimy"
    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("image", "mask", "meta_prompt")
    FUNCTION = "load_image"

    def load_image(self, image, meta_prompt=""):
        image_path = folder_paths.get_annotated_filepath(image)

        # MP4の場合はダミー画像を返してメタデータのみ提供
        if str(image_path).lower().endswith(".mp4"):
            dummy_image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            dummy_mask = torch.zeros((1, 64, 64), dtype=torch.float32)
            _, prompt_json = _parse_mp4_metadata(image_path)
            meta_prompt = _extract_prompt_from_json(prompt_json) if prompt_json else ""
            return (dummy_image, dummy_mask, meta_prompt)

        try:
            img = node_helpers.pillow(Image.open, image_path)
        except Exception as e:
            print(f"[Slimy_LoadImageSpy] Cannot open image file: {e}")
            raise ValueError(f"Unsupported file format: {image}")

        img = ImageOps.exif_transpose(img)

        meta_prompt = _extract_prompt(img)

        output_images = []
        output_masks = []
        w, h = None, None

        excluded_formats = ['MPO']

        for frame in ImageSequence.Iterator(img):
            frame = node_helpers.pillow(ImageOps.exif_transpose, frame)

            if frame.mode == 'I':
                frame = frame.point(lambda i: i * (1 / 255))

            has_alpha = 'A' in frame.getbands()

            if frame.mode == 'P':
                frame = frame.convert("RGBA")
            elif has_alpha:
                frame = frame.convert("RGBA")

            image_frame = frame.convert("RGB")

            if len(output_images) == 0:
                w = image_frame.size[0]
                h = image_frame.size[1]

            if image_frame.size[0] != w or image_frame.size[1] != h:
                print(f"[Slimy_LoadImageSpy] Skipping frame with mismatched size "
                      f"{image_frame.size} (expected {w}x{h})")
                continue

            image_np = np.array(image_frame).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_np)[None,]

            if 'A' in frame.getbands():
                mask = np.array(frame.getchannel('A')).astype(np.float32) / 255.0
                mask = 1.0 - torch.from_numpy(mask)
            else:
                mask = torch.zeros((image_frame.size[1], image_frame.size[0]),
                                   dtype=torch.float32)

            output_images.append(image_tensor)
            output_masks.append(mask.unsqueeze(0))

        if len(output_images) > 1 and img.format not in excluded_formats:
            output_image = torch.cat(output_images, dim=0)
            output_mask = torch.cat(output_masks, dim=0)
        else:
            output_image = output_images[0]
            output_mask = output_masks[0]

        return (output_image, output_mask, meta_prompt)

    @classmethod
    def VALIDATE_INPUTS(s, image, **kwargs):
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True


# ── ヘルパー関数 ──────────────────────────────────────

def _parse_mp4_metadata(file_path):
    """MP4バイナリからComfyUIのworkflowとpromptを抽出"""
    try:
        with open(file_path, "rb") as f:
            data = f.read()

        ilst_idx = data.find(b"ilst")
        if ilst_idx == -1:
            return None, None

        workflow = None
        prompt = None
        search_pos = ilst_idx

        while search_pos < min(ilst_idx + 500000, len(data)):
            data_idx = data.find(b"data\x00\x00\x00\x01\x00\x00\x00\x00", search_pos)
            if data_idx == -1:
                break
            size_pos = data_idx - 4
            if size_pos < 0:
                search_pos = data_idx + 1
                continue
            box_size = struct.unpack(">I", data[size_pos:size_pos+4])[0]
            json_start = data_idx + 12
            json_end = size_pos + box_size
            if json_end > len(data) or json_end <= json_start:
                search_pos = data_idx + 1
                continue
            json_bytes = data[json_start:json_end]
            try:
                json_str = json_bytes.decode("utf-8")
                obj = json.loads(json_str)
                # 二重エスケープされている場合はもう一度パース
                if isinstance(obj, str):
                    obj = json.loads(obj)
                if isinstance(obj, dict):
                    # {"prompt": ..., "workflow": ...} の形式
                    if "prompt" in obj and "workflow" in obj:
                        p = obj["prompt"]
                        w = obj["workflow"]
                        if isinstance(p, str):
                            p = json.loads(p)
                        if isinstance(w, str):
                            w = json.loads(w)
                        if isinstance(p, dict):
                            prompt = p
                        if isinstance(w, dict):
                            workflow = w
                    elif "nodes" in obj or "links" in obj:
                        workflow = obj
                    elif any("class_type" in str(v) for v in list(obj.values())[:3]):
                        prompt = obj
            except Exception:
                pass
            search_pos = data_idx + 1

        return workflow, prompt
    except Exception as e:
        print(f"[Slimy_LoadImageSpy] MP4 parse error: {e}")
        return None, None


_NG_WORDS = {
    "auto", "enable", "disable", "disabled", "none", "false", "true",
    "cpu", "gpu", "default", "always", "longest", "null", "source", "en", "ja",
}


def _extract_json_from_str(s, key):
    """文字列sの中から 'key:{...}' のJSON部分を抽出して返す。見つからなければNone。"""
    marker = f"{key}:{{"
    idx = s.find(marker)
    if idx == -1:
        return None
    brace_count = 0
    start = idx + len(f"{key}:")
    for i, c in enumerate(s[start:], start):
        if c == '{':
            brace_count += 1
        elif c == '}':
            brace_count -= 1
            if brace_count == 0:
                return s[start:i + 1]
    return None


def _extract_from_exif(img, key):
    """webp等のEXIFから指定キーのJSONを取り出す"""
    try:
        exif_data = img.info.get("exif", b"")
        if not exif_data:
            return None
        exif_str = exif_data.decode("utf-8", errors="ignore")
        return _extract_json_from_str(exif_str, key)
    except Exception:
        return None


def _parse_prompt_json(prompt_json):
    sep = "\n//////////////////////////////\n"
    seen = set()
    _POSI_KEYWORDS = ["posi", "\u30d7\u30ed\u30f3\u30d7\u30c8", "positive", "prompt"]
    _NEGA_KEYWORDS = ["nega", "negative"]
    _CLIP_TYPE = "CLIPTextEncode"
    entries = []
    for node in prompt_json.values():
        class_type = node.get("class_type", "")
        title = node.get("_meta", {}).get("title", "").lower()
        inputs = node.get("inputs", {})
        is_clip = class_type == _CLIP_TYPE
        has_posi = any(k in title for k in _POSI_KEYWORDS)
        has_nega = any(k in title for k in _NEGA_KEYWORDS)
        is_posi = is_clip and has_posi and not has_nega
        is_nega = is_clip and has_nega
        for val in inputs.values():
            if not isinstance(val, str) or not val.strip():
                continue
            text = val.strip()
            if text.lower() in _NG_WORDS:
                continue
            if text in seen:
                continue
            seen.add(text)
            entries.append((text, is_posi, is_nega))
    if not entries:
        return ""
    def has_chinese(text):
        return any("\u4e00" <= c <= "\u9fff" for c in text)
    def has_kana(text):
        return any("\u3040" <= c <= "\u309f" or "\u30a0" <= c <= "\u30ff" for c in text)
    jp_entries = [e for e in entries if has_kana(e[0])]
    other_entries = [e for e in entries if not has_kana(e[0])]
    def sort_key(e):
        is_posi, is_nega = e[1], e[2]
        is_chinese_only = has_chinese(e[0]) and not has_kana(e[0])
        priority = 0 if is_posi else (2 if (is_nega or is_chinese_only) else 1)
        return (priority, -len(e[0]))
    other_entries.sort(key=sort_key)
    entries = jp_entries + other_entries
    return sep.join(e[0] for e in entries)


def _extract_prompt_from_json(prompt_json):
    try:
        return _parse_prompt_json(prompt_json)
    except Exception as e:
        print(f"[Slimy_LoadImageSpy] Failed to parse prompt JSON: {e}")
        return ""


def _extract_prompt(img):
    try:
        prompt_str = img.info.get("prompt", None)
        if not prompt_str:
            prompt_str = _extract_from_exif(img, "prompt")
        if not prompt_str:
            return ""

        prompt_json = json.loads(prompt_str)
        return _parse_prompt_json(prompt_json)

    except Exception as e:
        print(f"[Slimy_LoadImageSpy] Failed to parse metadata: {e}")
        return ""


# ── APIエンドポイント ─────────────────────────────────

@server.PromptServer.instance.routes.get("/slimy/image_workflow")
async def get_image_workflow(request):
    filename = request.query.get("filename", "")
    if not filename:
        return web.json_response({"workflow": None})

    try:
        image_path = folder_paths.get_annotated_filepath(filename)
        # MP4の場合はバイナリ解析
        if str(image_path).lower().endswith(".mp4"):
            workflow, _ = _parse_mp4_metadata(image_path)
            return web.json_response({"workflow": workflow})
        img = Image.open(image_path)
        workflow_str = img.info.get("workflow", None)
        if not workflow_str:
            workflow_str = _extract_from_exif(img, "workflow")
        if not workflow_str:
            return web.json_response({"workflow": None})
        workflow = json.loads(workflow_str)
        return web.json_response({"workflow": workflow})
    except Exception as e:
        print(f"[Slimy_LoadImageSpy] Workflow API error: {e}")
        return web.json_response({"workflow": None})


@server.PromptServer.instance.routes.get("/slimy/image_meta")
async def get_image_meta(request):
    filename = request.query.get("filename", "")
    if not filename:
        return web.json_response({"meta_prompt": "no metadata"})

    try:
        image_path = folder_paths.get_annotated_filepath(filename)
        # MP4の場合はバイナリ解析
        if str(image_path).lower().endswith(".mp4"):
            _, prompt = _parse_mp4_metadata(image_path)
            meta = _extract_prompt_from_json(prompt) if prompt else ""
            return web.json_response({"meta_prompt": meta if meta else "//////// No Metadata ////////\nThis file does not contain any prompt or workflow information."})
        img = Image.open(image_path)
        meta = _extract_prompt(img)
        return web.json_response({"meta_prompt": meta if meta else "//////// No Metadata ////////\nThis file does not contain any prompt or workflow information."})
    except Exception as e:
        print(f"[Slimy_LoadImageSpy] API error: {e}")
        return web.json_response({"meta_prompt": "no metadata"})

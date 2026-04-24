from .slimy_load_image_spy import Slimy_LoadImageSpy

NODE_CLASS_MAPPINGS = {
    "Slimy_LoadImageSpy": Slimy_LoadImageSpy,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Slimy_LoadImageSpy": "Slimy_Load Image Spy🕵️",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

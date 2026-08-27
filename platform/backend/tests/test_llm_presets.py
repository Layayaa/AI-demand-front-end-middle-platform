import unittest

from app.llm_presets import public_llm_presets


class LlmPresetTests(unittest.TestCase):
    def test_presets_have_unique_ids_and_openai_compatible_urls(self) -> None:
        presets = public_llm_presets()
        ids = [item["id"] for item in presets]

        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreaterEqual(len(presets), 8)
        for preset in presets:
            self.assertTrue(preset["baseUrl"].startswith(("http://", "https://")))
            self.assertTrue(preset["model"])
            self.assertTrue(preset["qualityModel"])
            self.assertTrue(preset["docsUrl"].startswith("https://"))


if __name__ == "__main__":
    unittest.main()

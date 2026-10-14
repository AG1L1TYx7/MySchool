"""Streamed answers are moderated before release (docs/21 F05)."""

from app.safety import release_segments, strip_personal_data


def test_release_waits_for_a_sentence_boundary_and_a_minimum_length() -> None:
    assert release_segments("Call me") == ("", "Call me")
    assert release_segments("Photosynthesis turns light into sugar. Then the") == (
        "Photosynthesis turns light into sugar.",
        " Then the",
    )
    long_open = "a long sentence with no end yet because it keeps going"
    assert release_segments(long_open) == ("", long_open)
    release, rest = release_segments("First line here\nsecond part")
    assert release == "First line here\n" and rest == "second part"


def test_a_number_split_across_tokens_is_stripped_before_release() -> None:
    tokens = ["You can reach the office at 555-", "123-4567 any time. ", "Bring the form."]
    pending, shown = "", []
    for token in tokens:
        pending += token
        release, pending = release_segments(pending)
        if release:
            shown.append(strip_personal_data(release))
    shown.append(strip_personal_data(pending))
    assert "555-123-4567" not in "".join(shown)
    assert "[number removed]" in "".join(shown)

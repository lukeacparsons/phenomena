"""One poster policy for collection, fallback, grouping and refresh merges."""

IMAGE_POLICY_VERSION = 4
MINIMUM = (600, 900)


def is_portrait(width, height):
    # At equal widths, 4:3 through 8:5 heights differ by at most 20%.
    return bool(width and height and 4 * width <= 3 * height and 5 * height <= 8 * width)


def meets_target(width, height, minimum=MINIMUM):
    return bool(is_portrait(width, height) and width >= minimum[0] and height >= minimum[1])


def usable_poster(width, height):
    # Smaller or 4:5 theatrical posters can still replace landscape thumbnails
    # when no target-sized artwork exists. The card contains the full image.
    return bool(width and height and width >= 240 and height >= 320
                and .60 <= width / height <= .82)


def poster_quality(width, height, minimum=MINIMUM):
    # A genuine portrait thumbnail is preferable to a high-resolution still.
    return (usable_poster(width, height), is_portrait(width, height), meets_target(width, height, minimum),
            (width or 0) * (height or 0))


def prefer_poster(candidate, current, minimum=MINIMUM):
    return bool(candidate.get('poster_url')) and poster_quality(
        candidate.get('poster_width'), candidate.get('poster_height'), minimum) > poster_quality(
        current.get('poster_width'), current.get('poster_height'), minimum)


def copy_poster(candidate, current):
    """Replace artwork together with its provenance; discard stale derivatives."""
    for key in ('poster_url', 'poster_width', 'poster_height', 'poster_original', 'poster_provenance', 'poster_image'):
        if key in candidate: current[key] = candidate[key]
        else: current.pop(key, None)

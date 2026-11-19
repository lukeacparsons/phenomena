"""One poster policy for collection, fallback, grouping and refresh merges."""

IMAGE_POLICY_VERSION = 3
MINIMUM = (600, 900)


def meets_target(width, height, minimum=MINIMUM):
    # Real theatrical artwork includes 4:5 portraits as well as 2:3. Allow
    # export rounding (1290 x 1611), but not squares, banners or narrow strips.
    return bool(width and height and width >= minimum[0] and height >= minimum[1]
                and .60 <= width / height <= .82)


def poster_quality(width, height, minimum=MINIMUM):
    return (meets_target(width, height, minimum), (width or 0) * (height or 0))


def prefer_poster(candidate, current, minimum=MINIMUM):
    return bool(candidate.get('poster_url')) and poster_quality(
        candidate.get('poster_width'), candidate.get('poster_height'), minimum) > poster_quality(
        current.get('poster_width'), current.get('poster_height'), minimum)


def copy_poster(candidate, current):
    """Replace artwork together with its provenance; discard stale derivatives."""
    for key in ('poster_url', 'poster_width', 'poster_height', 'poster_original', 'poster_provenance', 'poster_image'):
        if key in candidate: current[key] = candidate[key]
        else: current.pop(key, None)

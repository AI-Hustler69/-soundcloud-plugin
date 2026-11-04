/**
 * Plain-language guidance for SoundCloud license values. This is a hint for
 * the user, not legal advice: the uploader's own terms always win.
 */

export type PublicMixGuidance =
  | "likely_ok_with_attribution"
  | "non_commercial_only"
  | "no_derivatives_check_with_artist"
  | "permission_required"
  | "unknown";

export interface LicenseInfo {
  code: string | null;
  label: string;
  public_mix: PublicMixGuidance;
  note: string;
}

const CC_LABELS: Record<string, string> = {
  "cc-by": "Creative Commons Attribution (CC BY)",
  "cc-by-sa": "Creative Commons Attribution-ShareAlike (CC BY-SA)",
  "cc-by-nd": "Creative Commons Attribution-NoDerivatives (CC BY-ND)",
  "cc-by-nc": "Creative Commons Attribution-NonCommercial (CC BY-NC)",
  "cc-by-nc-sa": "Creative Commons Attribution-NonCommercial-ShareAlike (CC BY-NC-SA)",
  "cc-by-nc-nd": "Creative Commons Attribution-NonCommercial-NoDerivatives (CC BY-NC-ND)",
};

export function describeLicense(code: string | null | undefined): LicenseInfo {
  const c = code?.trim().toLowerCase() || null;
  if (!c) {
    return {
      code: null,
      label: "Unknown",
      public_mix: "unknown",
      note: "No license information. Treat as all rights reserved and ask the artist before using it in a public mix.",
    };
  }
  if (c === "all-rights-reserved") {
    return {
      code: c,
      label: "All rights reserved",
      public_mix: "permission_required",
      note: "A free download does not grant rights to publish, stream or monetise a mix. Get the artist's permission (or rely on a platform licence) before using it publicly.",
    };
  }
  if (c === "no-rights-reserved" || c === "cc0") {
    return {
      code: c,
      label: "No rights reserved (public domain dedication)",
      public_mix: "likely_ok_with_attribution",
      note: "Generally free to use; crediting the artist is still good practice.",
    };
  }
  if (c in CC_LABELS) {
    const label = CC_LABELS[c] ?? c;
    if (c.includes("-nc")) {
      return {
        code: c,
        label,
        public_mix: c.includes("-nd") ? "no_derivatives_check_with_artist" : "non_commercial_only",
        note: c.includes("-nd")
          ? "Non-commercial and no derivatives: a mix may count as an adaptation. Only use publicly with the artist's permission; never in monetised content."
          : "Non-commercial only: fine for a non-monetised mix with credit; not for paid gigs, monetised uploads or sponsored content without permission.",
      };
    }
    if (c.includes("-nd")) {
      return {
        code: c,
        label,
        public_mix: "no_derivatives_check_with_artist",
        note: "No derivatives: a mix that edits, loops or blends the track may count as an adaptation. Check with the artist.",
      };
    }
    return {
      code: c,
      label,
      public_mix: "likely_ok_with_attribution",
      note: c === "cc-by-sa"
        ? "Allowed with credit; a mix that adapts the track must be shared under the same licence."
        : "Allowed with credit to the artist.",
    };
  }
  return {
    code: c,
    label: c,
    public_mix: "unknown",
    note: "Unrecognised license value. Check the track page and ask the artist before public use.",
  };
}

export const LICENSE_REMINDER =
  "\"Free download\" on SoundCloud usually means personal use only. Check each track's license (and the artist's description) before using it in a public, streamed or monetised mix.";

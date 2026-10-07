// Place any global data in this file.
// You can import this data from anywhere in your site by using the `import` keyword.

export const SITE_TITLE = "Engineers.SG";
export const SITE_DESCRIPTION = "Videos of tech meetups and conferences in Singapore, recorded by Engineers.SG, a not-for-profit community initiative documenting the Singapore tech and startup scene.";

// The types of a presenter's or organization's links (ProfileLinkType in @esg/db-types/content),
// with the name shown to screen readers and as the tooltip.
export const PROFILE_LINK_TYPES = ["x", "website", "linkedin", "instagram", "tiktok"] as const;
export type ProfileLinkType = (typeof PROFILE_LINK_TYPES)[number];
export const PROFILE_LINK_NAMES: Record<ProfileLinkType, string> = {
  x: "X",
  website: "Website",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  tiktok: "TikTok",
};

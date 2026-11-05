// The site's topic taxonomy (the /categories page): groups of topics, each with the keywords that
// seed it. A video stores the slugs of its topics in `topics`. The keywords are regular-expression
// sources, matched case-insensitively against a video's title and the start of its description by
// `topicsFor`; they only seed the field (`pnpm cms topics seed`), after which `topics` is edited by
// hand or through the submission form. No Node imports: the website imports this file too.

export interface Topic {
  slug: string;
  title: string;
  keywords: string[];
}

export interface TopicGroup {
  slug: string;
  title: string;
  topics: Topic[];
}

const t = (title: string, ...keywords: string[]): Topic => ({
  slug: title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, ""),
  title,
  keywords,
});

export const TOPIC_GROUPS: TopicGroup[] = [
  {
    slug: "languages",
    title: "Programming Languages",
    topics: [
      t("Python", String.raw`\bpython`, String.raw`\bpycon`, String.raw`\bdjango`, String.raw`\bflask\b`, String.raw`\bpandas\b`, String.raw`\bpydata`),
      t("JavaScript & TypeScript", String.raw`\bjavascript`, String.raw`\btypescript`, String.raw`\bjsconf`, String.raw`\bnode\.?js`, String.raw`\bes6\b`, String.raw`\bsingaporejs`, String.raw`\bdeno\b`),
      t("Ruby & Rails", String.raw`\bruby`, String.raw`\brails\b`, String.raw`\brubysg`),
      t("PHP", String.raw`\bphp`, String.raw`\blaravel`, String.raw`\bsymfony`),
      t("Go", String.raw`\bgolang`, String.raw`\bgopher`, String.raw`\bgo (?:with|modules|concurrency|routines?)\b`),
      t("Rust", String.raw`\brust\b`),
      t("Java & JVM", String.raw`\bjava\b`, String.raw`\bscala\b`, String.raw`\bkotlin`, String.raw`\bclojure`, String.raw`\bspring (?:boot|framework|user)`, String.raw`\bjvm\b`),
      t("Functional programming", String.raw`\bhaskell`, String.raw`\belm\b`, String.raw`\belixir`, String.raw`\berlang`, String.raw`\bfunctional`, String.raw`\bocaml`, String.raw`\bf#`),
      t(".NET & C#", String.raw`\.net\b`, String.raw`\bc#`, String.raw`\bxamarin`, String.raw`\basp\.net`),
    ],
  },
  {
    slug: "web-mobile",
    title: "Web & Mobile",
    topics: [
      t("Frontend & UI frameworks", String.raw`\breact`, String.raw`\bvue`, String.raw`\bangular`, String.raw`\bcss\b`, String.raw`\bhtml5?\b`, String.raw`\bfrontend|front-end`, String.raw`\bwebpack`, String.raw`\bwebassembly|\bwasm\b`, String.raw`\bsingaporecss`),
      t("APIs & backend", String.raw`\bgraphql`, String.raw`\bapi\b`, String.raw`\bapis\b`, String.raw`\brest(?:ful)?\b`, String.raw`\bhttp/?2`, String.raw`\bbackend|back-end`, String.raw`\bmicroservice`),
      t("Mobile development", String.raw`\bios\b`, String.raw`\bandroid`, String.raw`\bswift\b`, String.raw`\bflutter`, String.raw`\breact native`, String.raw`\bmobile`),
      t("WordPress & CMS", String.raw`\bwordpress`, String.raw`\bwordcamp`, String.raw`\bdrupal`, String.raw`\bmagento`, String.raw`\bcms\b`),
    ],
  },
  {
    slug: "cloud-devops",
    title: "Cloud, DevOps & Data",
    topics: [
      t("Cloud platforms", String.raw`\baws\b`, String.raw`\bamazon web`, String.raw`\bazure`, String.raw`\bgoogle cloud`, String.raw`\bgcp\b`, String.raw`\bserverless`, String.raw`\bcloud foundry`, String.raw`\bbluemix`, String.raw`\bcloud\b`),
      t("Containers & Kubernetes", String.raw`\bdocker`, String.raw`\bkubernetes`, String.raw`\bk8s\b`, String.raw`\bcontainer`),
      t("DevOps & reliability", String.raw`\bdevops`, String.raw`\bdevsecops`, String.raw`\bci/?cd\b`, String.raw`\bansible`, String.raw`\bterraform`, String.raw`\bprometheus`, String.raw`\bmonitoring`, String.raw`\bsre\b`, String.raw`\bcontinuous (?:deploy|integration|deliver)`, String.raw`\bdeployment`),
      t("Databases & data engineering", String.raw`\bsql\b`, String.raw`\bmysql`, String.raw`\bmariadb`, String.raw`\bpostgres`, String.raw`\bmongodb`, String.raw`\bredis\b`, String.raw`\bdatabase`, String.raw`\bhadoop`, String.raw`\bspark\b`, String.raw`\bbig ?data`, String.raw`\bkafka`, String.raw`\bdata engineering`),
    ],
  },
  {
    slug: "ai-data-science",
    title: "AI, Data Science & Blockchain",
    topics: [
      t("Machine learning & AI", String.raw`\bmachine learning`, String.raw`\bdeep learning`, String.raw`\btensorflow`, String.raw`\bai\b`, String.raw`\bneural`, String.raw`\bnlp\b`, String.raw`\bchatbots?\b`, String.raw`\bartificial intelligence`, String.raw`\bllm`, String.raw`\bgpt`),
      t("Data science & analytics", String.raw`\bdata science`, String.raw`\bdata scientist`, String.raw`\banalytics`, String.raw`\bdata visuali[sz]ation`, String.raw`\bpydata`, String.raw`\bopen data`),
      t("Blockchain & crypto", String.raw`\bblockchain`, String.raw`\bbitcoin`, String.raw`\bethereum`, String.raw`\bcryptocurrenc`, String.raw`\bdecentrali[sz]ed`, String.raw`\bdapps?\b`, String.raw`\bsmart contract`),
    ],
  },
  {
    slug: "systems",
    title: "Systems, Security & Open Source",
    topics: [
      t("Security & hacking", String.raw`\bsecurity`, String.raw`\bhack(?:ing|ers?)?\b`, String.raw`\bvulnerabilit`, String.raw`\bpen ?test`, String.raw`\bgreyhats`, String.raw`\bctf\b`, String.raw`\bmalware`, String.raw`\bencryption`, String.raw`\bnull singapore`),
      t("Linux & operating systems", String.raw`\blinux`, String.raw`\bkernel`, String.raw`\bunix`, String.raw`\boperating system`, String.raw`\bemacs`, String.raw`\bvim\b`, String.raw`\bubuntu`, String.raw`\bfedora`),
      t("Open source & community", String.raw`\bopen[- ]source`, String.raw`\bfossasia`, String.raw`\bfoss\b`, String.raw`\boss\b`, String.raw`\bmozilla`),
      t("Software architecture & practice", String.raw`\bagile`, String.raw`\bscrum`, String.raw`\btdd\b`, String.raw`\btesting`, String.raw`\bcode review`, String.raw`\brefactor`, String.raw`\barchitecture`, String.raw`\bdesign patterns?`, String.raw`\bclean code`, String.raw`\bperformance`),
    ],
  },
  {
    slug: "hardware-making",
    title: "Hardware & Making",
    topics: [
      t("Electronics & IoT", String.raw`\bhackware`, String.raw`\barduino`, String.raw`\braspberry`, String.raw`\biot\b`, String.raw`\besp32|\besp8266`, String.raw`\bsensors?\b`, String.raw`\belectronic`, String.raw`\bcircuit`, String.raw`\bpcb\b`, String.raw`\bmicrocontroller`, String.raw`\bfpga`, String.raw`\bhardware`),
      t("Robotics & autonomous machines", String.raw`\brobot`, String.raw`\bros\b`, String.raw`\bdrones?\b`, String.raw`\bself-driving`, String.raw`\bautonomous`),
      t("VR, AR & games", String.raw`\bvr\b`, String.raw`\bvirtual reality`, String.raw`\baugmented reality`, String.raw`\bunity\b`, String.raw`\bgames?\b`, String.raw`\bgame dev`, String.raw`\bigda`, String.raw`\bunreal`),
      t("3D printing & maker projects", String.raw`\b3d print`, String.raw`\bmaker`, String.raw`\bcnc\b`, String.raw`\blaser cut`, String.raw`\btinker`),
    ],
  },
  {
    slug: "product-design",
    title: "Product, Design & Careers",
    topics: [
      t("Product management", String.raw`\bproduct manage`, String.raw`\bproductcamp`, String.raw`\bproduct ?tank`, String.raw`\broadmap`, String.raw`\bproduct (?:owner|strategy|market)`),
      t("Design & UX", String.raw`\bux\b`, String.raw`\bui/ux`, String.raw`\buser experience`, String.raw`\bdesign thinking`, String.raw`\binteraction design`, String.raw`\bdesignsg`, String.raw`\bixda`, String.raw`\bdesigners?\b`),
      t("Startups & entrepreneurship", String.raw`\bstartups?\b`, String.raw`\bfuckup`, String.raw`\bentrepreneur`, String.raw`\bfounders?\b`, String.raw`\binnovation`, String.raw`\bfundrais`, String.raw`\bventure`),
      t("Careers & learning", String.raw`\bcareers?\b`, String.raw`\bjunior developers?`, String.raw`\bwomen who code`, String.raw`\btechladies`, String.raw`\bmentor`, String.raw`\bbootcamp`, String.raw`\bhiring`, String.raw`\blearn(?:ing)? to code`, String.raw`\brails girls`),
    ],
  },
];

export const TOPICS: Topic[] = TOPIC_GROUPS.flatMap((g) => g.topics);

/** The group of each topic, by topic slug. */
export const GROUP_OF_TOPIC = new Map(TOPIC_GROUPS.flatMap((g) => g.topics.map((x) => [x.slug, g] as const)));

/** The topic slugs that exist, to check a stored value or an option. */
export const isTopicSlug = (slug: string) => GROUP_OF_TOPIC.has(slug);

const patterns = new Map(TOPICS.map((x) => [x.slug, new RegExp(x.keywords.join("|"), "i")]));

/** How much of the description is searched: past that it is usually sponsors, schedules and links. */
const DESCRIPTION_CHARS = 400;

/** The slugs of the topics whose keywords appear in a video's title or the start of its description, in taxonomy order. */
export function topicsFor(title: string, description = ""): string[] {
  const text = `${title}\n${description.slice(0, DESCRIPTION_CHARS)}`;
  return TOPICS.filter((x) => patterns.get(x.slug)!.test(text)).map((x) => x.slug);
}

/** The same data with `topics` set, placed after `presenters` like every file lists it. Empty removes the field. */
export function withTopics<T extends { presenters: string[] }>(data: T, topics: string[]): T {
  const { topics: _old, ...rest } = data as T & { topics?: string[] };
  if (!topics.length) return rest as T;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(rest)) {
    out[key] = v;
    if (key === "presenters") out.topics = topics;
  }
  return out as T;
}

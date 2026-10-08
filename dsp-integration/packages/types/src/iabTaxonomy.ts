/* The IAB Tech Lab Content Taxonomy 1.0 in full: 26 tier-1 categories and
   their tier-2 subcategories, with the codes OpenRTB 2.x carries in
   bcat / bid.cat (IAB8 for a tier 1, IAB8-16 for a tier 2). This is the
   taxonomy Google Authorized Buyers / DV360 default to and The Trade Desk
   maps from, so it is the common denominator rather than a PH-only subset.
   (Taxonomy 2.x is newer; the OpenRTB 2.5/2.6 category fields still carry
   1.0 codes unless `cattax` says otherwise, and ours does not.)
   An entry is stored by name: a tier 1 by its name ("Food & Drink"), a tier 2
   as "Tier 1 › Tier 2" ("Food & Drink › Vegan"). Blocking or allowing a tier 1
   covers its subcategories — that is how the OpenRTB codes nest. */

/* [tier-1 number, name, [tier-2 names in code order]] */
const TAXONOMY: [number, string, string[]][] = [
  [1, 'Arts & Entertainment', ['Books & Literature', 'Celebrity Fan/Gossip', 'Fine Art', 'Humor', 'Movies', 'Music', 'Television']],
  [2, 'Automotive', ['Auto Parts', 'Auto Repair', 'Buying/Selling Cars', 'Car Culture', 'Certified Pre-Owned', 'Convertible', 'Coupe', 'Crossover', 'Diesel', 'Electric Vehicle', 'Hatchback', 'Hybrid', 'Luxury', 'MiniVan', 'Motorcycles', 'Off-Road Vehicles', 'Performance Vehicles', 'Pickup', 'Road-Side Assistance', 'Sedan', 'Trucks & Accessories', 'Vintage Cars', 'Wagon']],
  [3, 'Business', ['Advertising', 'Agriculture', 'Biotech/Biomedical', 'Business Software', 'Construction', 'Forestry', 'Government', 'Green Solutions', 'Human Resources', 'Logistics', 'Marketing', 'Metals']],
  [4, 'Careers', ['Career Planning', 'College', 'Financial Aid', 'Job Fairs', 'Job Search', 'Resume Writing/Advice', 'Nursing', 'Scholarships', 'Telecommuting', 'U.S. Military', 'Career Advice']],
  [5, 'Education', ['7-12 Education', 'Adult Education', 'Art History', 'College Administration', 'College Life', 'Distance Learning', 'English as a 2nd Language', 'Language Learning', 'Graduate School', 'Homeschooling', 'Homework/Study Tips', 'K-6 Educators', 'Private School', 'Special Education', 'Studying Business']],
  [6, 'Family & Parenting', ['Adoption', 'Babies & Toddlers', 'Daycare/Pre School', 'Family Internet', 'Parenting - K-6 Kids', 'Parenting teens', 'Pregnancy', 'Special Needs Kids', 'Eldercare']],
  [7, 'Health & Fitness', ['Exercise', 'A.D.D.', 'AIDS/HIV', 'Allergies', 'Alternative Medicine', 'Arthritis', 'Asthma', 'Autism/PDD', 'Bipolar Disorder', 'Brain Tumor', 'Cancer', 'Cholesterol', 'Chronic Fatigue Syndrome', 'Chronic Pain', 'Cold & Flu', 'Deafness', 'Dental Care', 'Depression', 'Dermatology', 'Diabetes', 'Epilepsy', 'GERD/Acid Reflux', 'Headaches/Migraines', 'Heart Disease', 'Herbs for Health', 'Holistic Healing', "IBS/Crohn's Disease", 'Incest/Abuse Support', 'Incontinence', 'Infertility', "Men's Health", 'Nutrition', 'Orthopedics', 'Panic/Anxiety Disorders', 'Pediatrics', 'Physical Therapy', 'Psychology/Psychiatry', 'Senior Health', 'Sexuality', 'Sleep Disorders', 'Smoking Cessation', 'Substance Abuse', 'Thyroid Disease', 'Weight Loss', "Women's Health"]],
  [8, 'Food & Drink', ['American Cuisine', 'Barbecues & Grilling', 'Cajun/Creole', 'Chinese Cuisine', 'Cocktails/Beer', 'Coffee/Tea', 'Cuisine-Specific', 'Desserts & Baking', 'Dining Out', 'Food Allergies', 'French Cuisine', 'Health/Lowfat Cooking', 'Italian Cuisine', 'Japanese Cuisine', 'Mexican Cuisine', 'Vegan', 'Vegetarian', 'Wine']],
  [9, 'Hobbies & Interests', ['Art/Technology', 'Arts & Crafts', 'Beadwork', 'Birdwatching', 'Board Games/Puzzles', 'Candle & Soap Making', 'Card Games', 'Chess', 'Cigars', 'Collecting', 'Comic Books', 'Drawing/Sketching', 'Freelance Writing', 'Genealogy', 'Getting Published', 'Guitar', 'Home Recording', 'Investors & Patents', 'Jewelry Making', 'Magic & Illusion', 'Needlework', 'Painting', 'Photography', 'Radio', 'Roleplaying Games', 'Sci-Fi & Fantasy', 'Scrapbooking', 'Screenwriting', 'Stamps & Coins', 'Video & Computer Games', 'Woodworking']],
  [10, 'Home & Garden', ['Appliances', 'Entertaining', 'Environmental Safety', 'Gardening', 'Home Repair', 'Home Theater', 'Interior Decorating', 'Landscaping', 'Remodeling & Construction']],
  [11, "Law, Gov't & Politics", ['Immigration', 'Legal Issues', 'U.S. Government Resources', 'Politics', 'Commentary']],
  [12, 'News', ['International News', 'National News', 'Local News']],
  [13, 'Personal Finance', ['Beginning Investing', 'Credit/Debt & Loans', 'Financial News', 'Financial Planning', 'Hedge Fund', 'Insurance', 'Investing', 'Mutual Funds', 'Options', 'Retirement Planning', 'Stocks', 'Tax Planning']],
  [14, 'Society', ['Dating', 'Divorce Support', 'Gay Life', 'Marriage', 'Senior Living', 'Teens', 'Weddings', 'Ethnic Specific']],
  [15, 'Science', ['Astrology', 'Biology', 'Chemistry', 'Geology', 'Paranormal Phenomena', 'Physics', 'Space/Astronomy', 'Geography', 'Botany', 'Weather']],
  [16, 'Pets', ['Aquariums', 'Birds', 'Cats', 'Dogs', 'Large Animals', 'Reptiles', 'Veterinary Medicine']],
  [17, 'Sports', ['Auto Racing', 'Baseball', 'Bicycling', 'Bodybuilding', 'Boxing', 'Canoeing/Kayaking', 'Cheerleading', 'Climbing', 'Cricket', 'Figure Skating', 'Fly Fishing', 'Football', 'Freshwater Fishing', 'Game & Fish', 'Golf', 'Horse Racing', 'Horses', 'Hunting/Shooting', 'Inline Skating', 'Martial Arts', 'Mountain Biking', 'NASCAR Racing', 'Olympics', 'Paintball', 'Power & Motorcycles', 'Pro Basketball', 'Pro Ice Hockey', 'Rodeo', 'Rugby', 'Running/Jogging', 'Sailing', 'Saltwater Fishing', 'Scuba Diving', 'Skateboarding', 'Skiing', 'Snowboarding', 'Surfing/Body-Boarding', 'Swimming', 'Table Tennis/Ping-Pong', 'Tennis', 'Volleyball', 'Walking', 'Waterski/Wakeboard', 'World Soccer']],
  [18, 'Style & Fashion', ['Beauty', 'Body Art', 'Fashion', 'Jewelry', 'Clothing', 'Accessories']],
  [19, 'Technology & Computing', ['3-D Graphics', 'Animation', 'Antivirus Software', 'C/C++', 'Cameras & Camcorders', 'Cell Phones', 'Computer Certification', 'Computer Networking', 'Computer Peripherals', 'Computer Reviews', 'Data Centers', 'Databases', 'Desktop Publishing', 'Desktop Video', 'Email', 'Graphics Software', 'Home Video/DVD', 'Internet Technology', 'Java', 'JavaScript', 'Linux', 'MP3/MIDI', 'Mac Support', 'Net Conferencing', 'Net for Beginners', 'Network Security', 'Palmtops/PDAs', 'PC Support', 'Portable', 'Entertainment', 'Shareware/Freeware', 'Unix', 'Visual Basic', 'Web Clip Art', 'Web Design/HTML', 'Web Search', 'Windows']],
  [20, 'Travel', ['Adventure Travel', 'Africa', 'Air Travel', 'Australia & New Zealand', 'Bed & Breakfasts', 'Budget Travel', 'Business Travel', 'By US Locale', 'Camping', 'Canada', 'Caribbean', 'Cruises', 'Eastern Europe', 'Europe', 'France', 'Greece', 'Honeymoons/Getaways', 'Hotels', 'Italy', 'Japan', 'Mexico & Central America', 'National Parks', 'South America', 'Spas', 'Theme Parks', 'Traveling with Kids', 'United Kingdom']],
  [21, 'Real Estate', ['Apartments', 'Architects', 'Buying/Selling Homes']],
  [22, 'Shopping', ['Contests & Freebies', 'Couponing', 'Comparison', 'Engines']],
  [23, 'Religion & Spirituality', ['Alternative Religions', 'Atheism/Agnosticism', 'Buddhism', 'Catholicism', 'Christianity', 'Hinduism', 'Islam', 'Judaism', 'Latter-Day Saints', 'Pagan/Wiccan']],
  [24, 'Uncategorized', []],
  [25, 'Non-Standard Content', ['Unmoderated UGC', 'Extreme Graphic/Explicit Violence', 'Pornography', 'Profane Content', 'Hate Content', 'Under Construction', 'Incentivized']],
  [26, 'Illegal Content', ['Illegal Content', 'Warez', 'Spyware/Malware', 'Copyright Infringement']],
]

export interface IabCategory { name: string; code: string; tier: 1 | 2; parent?: string }

/* Every category, tier 1 immediately followed by its subcategories. */
export const IAB_TAXONOMY: readonly IabCategory[] = TAXONOMY.flatMap(([n, name, subs]) => [
  { name, code: `IAB${n}`, tier: 1 as const },
  ...subs.map((s, i) => ({ name: `${name} › ${s}`, code: `IAB${n}-${i + 1}`, tier: 2 as const, parent: name })),
])

/* Names the first, eight-category list used before the full taxonomy. They
   stay valid so saved whitelists, blacklists and invited categories keep
   working; each maps to the code it always sent. */
export const IAB_LEGACY_CATEGORIES: Record<string, string> = { Beauty: 'IAB18-1', Retail: 'IAB22', Finance: 'IAB13' }

export const IAB_CATEGORIES: readonly string[] = IAB_TAXONOMY.map((c) => c.name)
/* Name → OpenRTB code, legacy names included. */
export const IAB_CATEGORY_CODES: Record<string, string> = {
  ...IAB_LEGACY_CATEGORIES,
  ...Object.fromEntries(IAB_TAXONOMY.map((c) => [c.name, c.code])),
}

const BY_KEY = new Map<string, string>([...Object.keys(IAB_LEGACY_CATEGORIES), ...IAB_CATEGORIES].map((n) => [n.trim().toLowerCase(), n]))
/* The canonical spelling of a category name (matched without regard to case), or undefined if it is not in the taxonomy. */
export const canonicalIabCategory = (name: unknown): string | undefined => (typeof name === 'string' ? BY_KEY.get(name.trim().toLowerCase()) : undefined)

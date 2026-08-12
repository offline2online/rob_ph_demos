#!/usr/bin/env python3
"""Generate kfcuk-import.json — KFC UK menu import (GBP), GS1 VOC compliant."""
import json, base64, datetime

def b64svg(svg_str):
    return "data:image/svg+xml;base64," + base64.b64encode(svg_str.encode("utf-8")).decode("utf-8")

def card_svg(icon, label, bg="#e4002b", accent="#ffffff"):
    return b64svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">'
        '<rect width="400" height="300" fill="' + bg + '" rx="12"/>'
        '<rect x="8" y="8" width="384" height="284" fill="none" stroke="' + accent + '" stroke-width="3" rx="9"/>'
        '<text x="200" y="155" font-family="Segoe UI Emoji,Apple Color Emoji,Noto Emoji,Arial" '
        'font-size="110" text-anchor="middle" dominant-baseline="middle">' + icon + '</text>'
        '<text x="200" y="245" font-family="Arial,Helvetica,sans-serif" '
        'font-size="20" font-weight="bold" text-anchor="middle" fill="' + accent + '" letter-spacing="2">' + label + '</text>'
        '</svg>'
    )

imgs = {
    "buckets":   card_svg("\U0001f357", "BUCKETS",          "#e4002b", "#ffffff"),
    "banquets":  card_svg("\U0001f357", "BONELESS BANQUET",  "#000000", "#e4002b"),
    "burgers":   card_svg("\U0001f354", "BURGERS",           "#e4002b", "#ffffff"),
    "wraps":     card_svg("\U0001f32f", "WRAPS",             "#000000", "#e4002b"),
    "wings":     card_svg("\U0001f357", "WICKED WINGS",      "#e4002b", "#ffffff"),
    "popcorn":   card_svg("\U0001f357", "POPCORN CHICKEN",   "#000000", "#e4002b"),
    "sides":     card_svg("\U0001f35f", "SIDES",             "#e4002b", "#ffffff"),
    "dips":      card_svg("\U0001f96b", "DIPS",              "#000000", "#e4002b"),
    "desserts":  card_svg("\U0001f366", "DESSERTS",          "#e4002b", "#ffffff"),
    "drinks":    card_svg("\U0001f964", "DRINKS",            "#000000", "#e4002b"),
    "kids":      card_svg("\U0001f9d2", "KIDS MEAL",         "#e4002b", "#ffd200"),
    "vegan":     card_svg("\U0001f96c", "MEAT-FREE",         "#16a34a", "#ffffff"),
    "specials":  card_svg("\U0001f525", "MEAL DEALS",        "#000000", "#e4002b"),
}

logo = b64svg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300">'
    '<circle cx="150" cy="150" r="150" fill="#e4002b"/>'
    '<text x="150" y="128" font-family="Arial,Helvetica,sans-serif" font-size="70" font-weight="900" '
    'text-anchor="middle" dominant-baseline="middle" fill="#ffffff">KFC</text>'
    '<text x="150" y="190" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="700" '
    'text-anchor="middle" fill="#ffffff" letter-spacing="1">KENTUCKY FRIED</text>'
    '<text x="150" y="212" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="700" '
    'text-anchor="middle" fill="#ffffff" letter-spacing="1">CHICKEN</text>'
    '</svg>'
)

now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

BRAND_ID = "kfc-brand-001"

def mk(id_, sku, name, cat, desc, price, types, img_key):
    return {
        "id": id_,
        "sku": sku,
        "name": name,
        "category": cat,
        "description": desc,
        "price": round(float(price), 2),
        "menuTypes": types if isinstance(types, list) else [types],
        "images": [imgs[img_key]],
        "active": True,
        "createdAt": now,
        "updatedAt": now,
        "brand": BRAND_ID,
    }

FOOD = ["lunch", "dinner"]
items = []

# ============================================================
# BUCKETS
# ============================================================
items += [
    mk("kfc-001","KFC-BKT-001","10 pc Bucket","Buckets",
       "10 pieces of our Original Recipe chicken on the bone, hand-breaded in our secret blend of 11 herbs and spices.",
       14.99, FOOD, "buckets"),
    mk("kfc-002","KFC-BKT-002","6 pc Bucket","Buckets",
       "6 pieces of Original Recipe chicken on the bone, freshly hand-breaded and pressure cooked.",
       9.99, FOOD, "buckets"),
    mk("kfc-003","KFC-BKT-003","Family Feast Bucket","Buckets",
       "14 pieces of Original Recipe chicken, 2 large fries, 2 large sides and 4 regular drinks — feeds the whole family.",
       26.99, FOOD, "buckets"),
    mk("kfc-004","KFC-BKT-004","Boneless Bucket","Buckets",
       "8 pieces of 100% boneless Original Recipe chicken, perfect for sharing.",
       13.49, FOOD, "buckets"),
    mk("kfc-005","KFC-BKT-005","Mighty Bucket for One","Buckets",
       "2 pieces of Original Recipe chicken, 5 hot wings, fries, a regular side and a drink.",
       9.49, FOOD, "buckets"),
]

# ============================================================
# BONELESS BANQUETS
# ============================================================
items += [
    mk("kfc-010","KFC-BAN-001","Boneless Banquet","Boneless Banquets",
       "3 pieces of boneless Original Recipe chicken, fries, a regular side, a dip and a drink.",
       8.49, FOOD, "banquets"),
    mk("kfc-011","KFC-BAN-002","Zinger Boneless Banquet","Boneless Banquets",
       "3 pieces of spicy boneless Zinger chicken, fries, a regular side, a dip and a drink.",
       8.99, FOOD, "banquets"),
    mk("kfc-012","KFC-BAN-003","Wicked Boneless Banquet","Boneless Banquets",
       "3 pieces of Wicked Zinger boneless chicken with extra hot sauce, fries, a side and a drink.",
       9.29, FOOD, "banquets"),
]

# ============================================================
# BURGERS
# ============================================================
items += [
    mk("kfc-020","KFC-BUR-001","Zinger Burger","Burgers",
       "A spicy, crunchy fillet in a soft bun with fresh lettuce and mayo.",
       5.49, FOOD, "burgers"),
    mk("kfc-021","KFC-BUR-002","Original Recipe Burger","Burgers",
       "Our classic Original Recipe fillet with lettuce and mayo in a soft bun.",
       4.99, FOOD, "burgers"),
    mk("kfc-022","KFC-BUR-003","Fillet Burger","Burgers",
       "A tender, juicy chicken fillet burger with crisp lettuce and creamy mayo.",
       5.29, FOOD, "burgers"),
    mk("kfc-023","KFC-BUR-004","Zinger Stacker","Burgers",
       "Two spicy Zinger fillets stacked with bacon, cheese and BBQ sauce.",
       6.99, FOOD, "burgers"),
    mk("kfc-024","KFC-BUR-005","Fiery Zinger Burger","Burgers",
       "Our spiciest Zinger fillet yet, topped with a fiery sriracha-style sauce.",
       5.79, FOOD, "burgers"),
    mk("kfc-025","KFC-BUR-006","Zinger Cheese Burger","Burgers",
       "Spicy Zinger fillet topped with melted cheese, lettuce and mayo.",
       5.99, FOOD, "burgers"),
]

# ============================================================
# WRAPS & FLATBREADS
# ============================================================
items += [
    mk("kfc-030","KFC-WRP-001","Zinger Wrap","Wraps & Flatbreads",
       "Spicy Zinger chicken strips wrapped with lettuce and mayo in a soft tortilla.",
       4.99, FOOD, "wraps"),
    mk("kfc-031","KFC-WRP-002","Boneless Banquet Wrap","Wraps & Flatbreads",
       "Original Recipe chicken pieces, lettuce and mayo wrapped in a soft tortilla.",
       4.79, FOOD, "wraps"),
    mk("kfc-032","KFC-WRP-003","BBQ Tower Wrap","Wraps & Flatbreads",
       "Crispy chicken, a hash brown, cheese and smoky BBQ sauce in a tortilla wrap.",
       5.29, FOOD, "wraps"),
    mk("kfc-033","KFC-WRP-004","Flatbread Zinger","Wraps & Flatbreads",
       "Zinger chicken fillet on a toasted flatbread with fresh salad and a spicy mayo.",
       5.49, FOOD, "wraps"),
]

# ============================================================
# WICKED WINGS
# ============================================================
items += [
    mk("kfc-040","KFC-WNG-001","5 Wicked Wings","Wicked Wings",
       "5 wings coated in our fiery Wicked Wings seasoning.",
       3.99, FOOD, "wings"),
    mk("kfc-041","KFC-WNG-002","10 Wicked Wings","Wicked Wings",
       "10 wings coated in our fiery Wicked Wings seasoning — great for sharing.",
       6.99, FOOD, "wings"),
    mk("kfc-042","KFC-WNG-003","5 Hot Wings","Wicked Wings",
       "5 classic hot wings, freshly hand-breaded and fried to order.",
       3.79, FOOD, "wings"),
    mk("kfc-043","KFC-WNG-004","10 Hot Wings","Wicked Wings",
       "10 classic hot wings, freshly hand-breaded and fried to order.",
       6.49, FOOD, "wings"),
]

# ============================================================
# POPCORN CHICKEN
# ============================================================
items += [
    mk("kfc-050","KFC-POP-001","Regular Popcorn Chicken","Popcorn Chicken",
       "Bite-sized pieces of 100% chicken breast, freshly hand-breaded and fried.",
       3.49, FOOD, "popcorn"),
    mk("kfc-051","KFC-POP-002","Large Popcorn Chicken","Popcorn Chicken",
       "A large portion of bite-sized 100% chicken breast pieces, hand-breaded and fried.",
       4.49, FOOD, "popcorn"),
    mk("kfc-052","KFC-POP-003","Popcorn Chicken Box","Popcorn Chicken",
       "Popcorn chicken, fries, a dip and a drink.",
       6.99, FOOD, "popcorn"),
]

# ============================================================
# SIDES
# ============================================================
items += [
    mk("kfc-060","KFC-SID-001","Regular Fries","Sides", "Golden, crispy skin-on fries, lightly salted.", 1.99, FOOD, "sides"),
    mk("kfc-061","KFC-SID-002","Large Fries","Sides", "A large portion of our golden, crispy skin-on fries.", 2.49, FOOD, "sides"),
    mk("kfc-062","KFC-SID-003","Corn on the Cob","Sides", "A whole sweet, juicy corn on the cob.", 1.99, FOOD, "sides"),
    mk("kfc-063","KFC-SID-004","BBQ Beans","Sides", "Beans in a rich, smoky BBQ sauce.", 1.79, FOOD, "sides"),
    mk("kfc-064","KFC-SID-005","Gravy","Sides", "Our classic savoury chicken gravy.", 1.29, FOOD, "sides"),
    mk("kfc-065","KFC-SID-006","Coleslaw","Sides", "Fresh, crunchy coleslaw made with shredded cabbage and carrot.", 1.79, FOOD, "sides"),
    mk("kfc-066","KFC-SID-007","Mashed Potato & Gravy","Sides", "Creamy mashed potato topped with our classic gravy.", 2.29, FOOD, "sides"),
    mk("kfc-067","KFC-SID-008","Loaded Fries", "Sides", "Fries topped with cheese sauce, popcorn chicken pieces and a drizzle of BBQ sauce.", 4.29, FOOD, "sides"),
]

# ============================================================
# DIPS
# ============================================================
items += [
    mk("kfc-070","KFC-DIP-001","BBQ Dip","Dips", "Rich and smoky BBQ dipping sauce.", 0.69, FOOD, "dips"),
    mk("kfc-071","KFC-DIP-002","Garlic Mayo Dip","Dips", "Creamy garlic mayonnaise dip.", 0.69, FOOD, "dips"),
    mk("kfc-072","KFC-DIP-003","Sweet Chilli Dip","Dips", "Sweet and mildly spicy chilli dipping sauce.", 0.69, FOOD, "dips"),
    mk("kfc-073","KFC-DIP-004","Hot Sauce Dip","Dips", "Fiery hot sauce for dipping.", 0.69, FOOD, "dips"),
    mk("kfc-074","KFC-DIP-005","Mayo Dip","Dips", "Classic creamy mayonnaise.", 0.69, FOOD, "dips"),
]

# ============================================================
# DESSERTS
# ============================================================
items += [
    mk("kfc-080","KFC-DES-001","Chocolate Fudge Cake","Desserts", "A rich, gooey chocolate fudge cake slice.", 2.99, FOOD, "desserts"),
    mk("kfc-081","KFC-DES-002","Original Krushem","Desserts", "A thick, creamy vanilla-flavoured Krushem shake.", 2.99, ["drinks"], "desserts"),
    mk("kfc-082","KFC-DES-003","Oreo Krushem","Desserts", "A thick, creamy shake blended with crushed Oreo pieces.", 3.29, ["drinks"], "desserts"),
    mk("kfc-083","KFC-DES-004","Toffee Sundae","Desserts", "Soft-serve ice cream topped with a rich toffee sauce.", 2.49, FOOD, "desserts"),
]

# ============================================================
# DRINKS
# ============================================================
items += [
    mk("kfc-090","KFC-DRK-001","Pepsi","Drinks", "Ice-cold Pepsi cola.", 1.99, ["drinks"], "drinks"),
    mk("kfc-091","KFC-DRK-002","Pepsi Max","Drinks", "Ice-cold, no-sugar Pepsi Max.", 1.99, ["drinks"], "drinks"),
    mk("kfc-092","KFC-DRK-003","7UP","Drinks", "Crisp, refreshing lemon-lime 7UP.", 1.99, ["drinks"], "drinks"),
    mk("kfc-093","KFC-DRK-004","Tango Orange","Drinks", "Bold, fizzy orange Tango.", 1.99, ["drinks"], "drinks"),
    mk("kfc-094","KFC-DRK-005","Still Water","Drinks", "500ml bottle of still water.", 1.49, ["drinks"], "drinks"),
    mk("kfc-095","KFC-DRK-006","Large Fizzy Drink","Drinks", "A large serving of your favourite fizzy drink.", 2.29, ["drinks"], "drinks"),
]

# ============================================================
# KIDS MEALS
# ============================================================
items += [
    mk("kfc-100","KFC-KID-001","Kids Popcorn Chicken Meal","Kids Meals",
       "Popcorn chicken, a small fries, a small drink and a toy.",
       4.49, FOOD, "kids"),
    mk("kfc-101","KFC-KID-002","Kids Chicken Strip Meal","Kids Meals",
       "A chicken strip, a small fries, a small drink and a toy.",
       4.49, FOOD, "kids"),
]

# ============================================================
# MEAT-FREE / VEGAN
# ============================================================
items += [
    mk("kfc-110","KFC-VEG-001","Vegan Burger","Meat-Free",
       "A plant-based fillet in our signature coating with lettuce and vegan mayo.",
       5.49, FOOD, "vegan"),
    mk("kfc-111","KFC-VEG-002","Vegan Popcorn","Meat-Free",
       "Bite-sized pieces of plant-based popcorn, freshly fried.",
       3.99, FOOD, "vegan"),
    mk("kfc-112","KFC-VEG-003","Vegan Nuggets (5pc)","Meat-Free",
       "5 plant-based nuggets in our signature crispy coating.",
       3.49, FOOD, "vegan"),
]

# ============================================================
# MEAL DEALS / SPECIALS
# ============================================================
items += [
    mk("kfc-120","KFC-SPL-001","2 for £6.29 Zinger Deal","Meal Deals",
       "Any 2 Zinger Burgers for one unbeatable price.",
       6.29, ["specials"], "specials"),
    mk("kfc-121","KFC-SPL-002","Student Meal Deal","Meal Deals",
       "Any burger, fries and a regular drink at a special student price.",
       5.99, ["specials"], "specials"),
    mk("kfc-122","KFC-SPL-003","Lunch Time Deal","Meal Deals",
       "2 pieces of chicken, fries and a regular drink — weekday lunchtime special.",
       5.49, ["specials"], "specials"),
    mk("kfc-123","KFC-SPL-004","Big Bang Box","Meal Deals",
       "A burger, popcorn chicken, fries, a side and a drink — our biggest box meal.",
       9.99, ["specials"], "specials"),
]

categories = [
    "Buckets", "Boneless Banquets", "Burgers", "Wraps & Flatbreads", "Wicked Wings",
    "Popcorn Chicken", "Sides", "Dips", "Desserts", "Drinks", "Kids Meals",
    "Meat-Free", "Meal Deals",
]

brand = {
    "id": BRAND_ID,
    "name": "KFC",
    "currency": "£",
    "logo": logo,
    "logoRight": logo,
    "colors": {
        "header": "#e4002b",
        "accent": "#ffffff",
        "catBar": "#000000",
        "body": "#ffffff",
        "text": "#ffffff",
        "price": "#e4002b",
    },
    "display": {
        "portrait":  {"cols": 3, "rows": 5, "maxItems": 15},
        "landscape": {"cols": 5, "rows": 3, "maxItems": 15},
    },
    "showClock": True,
    "timeFormat": "british",
    "createdAt": now,
    "updatedAt": now,
}

data = {
    "@context": "https://gs1.org/voc/",
    "@type": "ItemList",
    "schemaVersion": "1.0",
    "description": "KFC UK menu import — GS1 VOC compliant. Prices in GBP (£). Items include gs1:recipeIngredient and gs1:customizationOptions auto-mapped on import.",
    "types": [
        {"id": "lunch",    "label": "Lunch",       "color": "#e4002b"},
        {"id": "dinner",   "label": "Dinner",      "color": "#000000"},
        {"id": "drinks",   "label": "Drinks",      "color": "#2563eb"},
        {"id": "specials", "label": "Meal Deals",  "color": "#f59e0b"},
    ],
    "items": items,
    "settings": {
        "brandName": "KFC",
        "currency": "£",
        "logo": logo,
        "logoRight": logo,
        "address": "Your Store Address",
        "phone": "",
        "tagline": "It's Finger Lickin' Good",
    },
    "categories": categories,
    "exportedAt": now,
    "brands": [brand],
}

with open("kfcuk-import.json", "w") as f:
    json.dump(data, f, indent=2)

print(f"Wrote kfcuk-import.json with {len(items)} items, {len(categories)} categories, currency GBP (£)")

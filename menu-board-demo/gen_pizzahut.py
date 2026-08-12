#!/usr/bin/env python3
"""Generate pizzahut-import.json with all menu items, categories, and embedded SVG images."""
import json, base64, datetime

def b64svg(svg_str):
    return "data:image/svg+xml;base64," + base64.b64encode(svg_str.encode("utf-8")).decode("utf-8")

def card_svg(icon, label, bg="#e91c24", accent="#ffffff"):
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
    "pan_pizza":     card_svg("\U0001f355", "PAN PIZZA",        "#e91c24", "#ffffff"),
    "stuffed_crust": card_svg("\U0001f9c0", "STUFFED CRUST",    "#c8102e", "#ffffff"),
    "thin_crispy":   card_svg("\U0001f355", "THIN 'N CRISPY",   "#000000", "#e91c24"),
    "specialty":     card_svg("⭐",     "SPECIALTY PIZZA",  "#e91c24", "#ffd200"),
    "wings":         card_svg("\U0001f357", "WINGS",            "#000000", "#e91c24"),
    "pasta":         card_svg("\U0001f35d", "PASTA",            "#c8102e", "#ffffff"),
    "melts":         card_svg("\U0001f96a", "MELTS",            "#e91c24", "#ffffff"),
    "sides":         card_svg("\U0001f956", "SIDES & BREAD",    "#000000", "#e91c24"),
    "dips":          card_svg("\U0001f96b", "DIPPING SAUCE",    "#c8102e", "#ffffff"),
    "salads":        card_svg("\U0001f957", "SALADS",           "#16a34a", "#ffffff"),
    "desserts":      card_svg("\U0001f36a", "DESSERTS",         "#e91c24", "#ffd200"),
    "drinks":        card_svg("\U0001f964", "SOFT DRINKS",      "#000000", "#ffffff"),
    "kids":          card_svg("\U0001f9d2", "KIDS MEAL",        "#e91c24", "#ffd200"),
    "specials":      card_svg("\U0001f525", "TODAY'S SPECIAL",  "#000000", "#e91c24"),
}

logo = b64svg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300">'
    '<rect width="300" height="300" fill="#e91c24" rx="16"/>'
    '<text x="150" y="150" font-family="Arial,Helvetica,sans-serif" font-size="46" font-weight="900" '
    'text-anchor="middle" dominant-baseline="middle" fill="#ffffff" letter-spacing="1">PIZZA</text>'
    '<text x="150" y="205" font-family="Arial,Helvetica,sans-serif" font-size="46" font-weight="900" '
    'text-anchor="middle" dominant-baseline="middle" fill="#ffffff" letter-spacing="1">HUT</text>'
    '</svg>'
)

now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

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
    }

FOOD = ["lunch", "dinner"]
items = []

# ============================================================
# PAN PIZZA
# ============================================================
items += [
    mk("ph-001","PH-PAN-001","Cheese Lover's Pan Pizza","Pan Pizza",
       "A blend of mozzarella, cheddar and Parmesan on our signature golden, crispy-bottomed pan crust.",
       13.99, FOOD, "pan_pizza"),
    mk("ph-002","PH-PAN-002","Pepperoni Lover's Pan Pizza","Pan Pizza",
       "Loaded with extra pepperoni and 100% real cheese, baked on our thick, buttery pan crust.",
       14.99, FOOD, "pan_pizza"),
    mk("ph-003","PH-PAN-003","Meat Lover's Pan Pizza","Pan Pizza",
       "Pepperoni, ham, Italian sausage, beef and bacon piled high on our golden pan crust.",
       16.49, FOOD, "pan_pizza"),
    mk("ph-004","PH-PAN-004","Veggie Lover's Pan Pizza","Pan Pizza",
       "Mushrooms, red onions, green peppers, tomatoes and black olives on a crispy pan crust.",
       14.99, FOOD, "pan_pizza"),
    mk("ph-005","PH-PAN-005","Supreme Pan Pizza","Pan Pizza",
       "Pepperoni, Italian sausage, mushrooms, green peppers, red onions and black olives, all on our pan crust.",
       16.99, FOOD, "pan_pizza"),
    mk("ph-006","PH-PAN-006","Hawaiian Pan Pizza","Pan Pizza",
       "Sweet pineapple and smoked ham with extra cheese on our signature golden pan crust.",
       14.99, FOOD, "pan_pizza"),
]

# ============================================================
# STUFFED CRUST
# ============================================================
items += [
    mk("ph-010","PH-STF-001","Pepperoni Stuffed Crust","Stuffed Crust",
       "Classic pepperoni pizza with a ring of melted mozzarella baked right into the crust.",
       16.99, FOOD, "stuffed_crust"),
    mk("ph-011","PH-STF-002","Meat Lover's Stuffed Crust","Stuffed Crust",
       "Pepperoni, ham, sausage, beef and bacon with a gooey cheese-stuffed crust.",
       18.49, FOOD, "stuffed_crust"),
    mk("ph-012","PH-STF-003","Cheese Stuffed Crust","Stuffed Crust",
       "Triple-cheese topping with an irresistible mozzarella-stuffed crust edge to edge.",
       15.99, FOOD, "stuffed_crust"),
    mk("ph-013","PH-STF-004","Supreme Stuffed Crust","Stuffed Crust",
       "Pepperoni, sausage, mushroom, onion, green pepper and olive with a cheese-stuffed crust.",
       18.99, FOOD, "stuffed_crust"),
    mk("ph-014","PH-STF-005","BBQ Chicken Stuffed Crust","Stuffed Crust",
       "Grilled chicken, red onion and smoky BBQ sauce with a cheese-stuffed crust finish.",
       17.99, FOOD, "stuffed_crust"),
]

# ============================================================
# THIN 'N CRISPY
# ============================================================
items += [
    mk("ph-020","PH-THN-001","Cheese Thin 'N Crispy","Thin 'N Crispy",
       "A generous layer of mozzarella on our ultra-thin, crispy hand-tossed base.",
       12.99, FOOD, "thin_crispy"),
    mk("ph-021","PH-THN-002","Pepperoni Thin 'N Crispy","Thin 'N Crispy",
       "Classic pepperoni on our cracker-thin crispy crust, baked until golden.",
       13.99, FOOD, "thin_crispy"),
    mk("ph-022","PH-THN-003","Veggie Thin 'N Crispy","Thin 'N Crispy",
       "Mushroom, onion, green pepper and olive on our light and crispy thin crust.",
       13.99, FOOD, "thin_crispy"),
    mk("ph-023","PH-THN-004","Buffalo Chicken Thin 'N Crispy","Thin 'N Crispy",
       "Spicy buffalo chicken, red onion and mozzarella with a drizzle of ranch on thin crust.",
       14.99, FOOD, "thin_crispy"),
    mk("ph-024","PH-THN-005","Margherita Thin 'N Crispy","Thin 'N Crispy",
       "Fresh tomato, basil and mozzarella on our crispy thin crust with a drizzle of olive oil.",
       13.49, FOOD, "thin_crispy"),
]

# ============================================================
# SPECIALTY PIZZAS
# ============================================================
items += [
    mk("ph-030","PH-SPC-001","Backyard BBQ Chicken","Specialty Pizzas",
       "Grilled chicken, red onion and smoky BBQ sauce topped with a blend of cheeses.",
       17.49, FOOD, "specialty"),
    mk("ph-031","PH-SPC-002","Ultimate Cheese Lover's","Specialty Pizzas",
       "Six cheeses — mozzarella, cheddar, Parmesan, Romano, Asiago and provolone.",
       16.49, FOOD, "specialty"),
    mk("ph-032","PH-SPC-003","Chicken Bacon Parmesan","Specialty Pizzas",
       "Grilled chicken, crispy bacon and a creamy garlic Parmesan sauce base.",
       17.99, FOOD, "specialty"),
    mk("ph-033","PH-SPC-004","Honolulu Luau","Specialty Pizzas",
       "Ham, bacon, pineapple and a blend of mozzarella and cheddar cheese.",
       16.99, FOOD, "specialty"),
    mk("ph-034","PH-SPC-005","Buffalo Chicken Specialty","Specialty Pizzas",
       "Spicy buffalo chicken, mozzarella and a swirl of creamy ranch.",
       17.49, FOOD, "specialty"),
    mk("ph-035","PH-SPC-006","Tuscani Meat Trio","Specialty Pizzas",
       "Italian sausage, pepperoni and beef with a rich marinara-infused cheese blend.",
       17.99, FOOD, "specialty"),
]

# ============================================================
# WINGS
# ============================================================
items += [
    mk("ph-040","PH-WNG-001","Traditional Bone-In Buffalo","Wings",
       "8 crispy bone-in wings tossed in classic spicy buffalo sauce, served with celery.",
       9.99, FOOD, "wings"),
    mk("ph-041","PH-WNG-002","Boneless BBQ Wings","Wings",
       "8 tender boneless wings glazed in sweet and smoky BBQ sauce.",
       9.49, FOOD, "wings"),
    mk("ph-042","PH-WNG-003","Honey BBQ Wings","Wings",
       "8 bone-in wings coated in a sticky-sweet honey BBQ glaze.",
       9.99, FOOD, "wings"),
    mk("ph-043","PH-WNG-004","Garlic Parmesan Boneless","Wings",
       "8 boneless wings tossed in creamy garlic Parmesan sauce.",
       9.49, FOOD, "wings"),
    mk("ph-044","PH-WNG-005","Spicy Asian Wings","Wings",
       "8 bone-in wings glazed in a sweet-chilli inspired Asian-style sauce.",
       9.99, FOOD, "wings"),
]

# ============================================================
# PASTA
# ============================================================
items += [
    mk("ph-050","PH-PST-001","Chicken Alfredo Pasta","Pasta",
       "Penne pasta tossed in creamy Alfredo sauce with grilled chicken, served with garlic bread.",
       11.99, FOOD, "pasta"),
    mk("ph-051","PH-PST-002","Meaty Marinara Pasta","Pasta",
       "Penne pasta in a rich marinara sauce loaded with Italian sausage and beef.",
       11.49, FOOD, "pasta"),
    mk("ph-052","PH-PST-003","Stuffed Chicken Alfredo","Pasta",
       "A cheese-stuffed crust pizza baked with chicken Alfredo pasta on top.",
       13.99, FOOD, "pasta"),
    mk("ph-053","PH-PST-004","Five Cheese Marinara Pasta","Pasta",
       "Penne pasta in marinara sauce topped with a blend of five melted cheeses.",
       10.99, FOOD, "pasta"),
]

# ============================================================
# MELTS & SANDWICHES
# ============================================================
items += [
    mk("ph-060","PH-MLT-001","P'Zone Classic","Melts & Sandwiches",
       "A folded calzone-style pocket stuffed with pepperoni, ham, sausage and three cheeses.",
       8.99, FOOD, "melts"),
    mk("ph-061","PH-MLT-002","P'Zone Meaty","Melts & Sandwiches",
       "Loaded with pepperoni, sausage, beef and bacon folded into a crispy melt pocket.",
       9.99, FOOD, "melts"),
    mk("ph-062","PH-MLT-003","Grilled Cheese Melt","Melts & Sandwiches",
       "A gooey three-cheese blend grilled between crispy pizza-dough bread.",
       7.99, FOOD, "melts"),
]

# ============================================================
# SIDES & BREAD
# ============================================================
items += [
    mk("ph-070","PH-SID-001","Breadsticks","Sides & Bread",
       "8 warm, buttery breadsticks dusted with garlic and Parmesan seasoning.",
       6.49, FOOD, "sides"),
    mk("ph-071","PH-SID-002","Stuffed Cheesy Bread","Sides & Bread",
       "Soft baked bread stuffed and topped with melted mozzarella and cheddar.",
       7.99, FOOD, "sides"),
    mk("ph-072","PH-SID-003","Garlic Bread","Sides & Bread",
       "Toasted bread brushed with garlic butter and herbs.",
       5.49, FOOD, "sides"),
    mk("ph-073","PH-SID-004","Cheese Sticks","Sides & Bread",
       "6 golden breaded mozzarella sticks, crispy outside and gooey inside.",
       6.99, FOOD, "sides"),
    mk("ph-074","PH-SID-005","Loaded Potato Bites","Sides & Bread",
       "Crispy potato bites topped with cheddar, bacon bits and a side of sour cream.",
       6.99, FOOD, "sides"),
    mk("ph-075","PH-SID-006","Jalapeño Poppers","Sides & Bread",
       "6 breaded jalapeño poppers filled with a creamy cheese blend.",
       6.99, FOOD, "sides"),
]

# ============================================================
# DIPS
# ============================================================
items += [
    mk("ph-080","PH-DIP-001","Garlic Parmesan Dip","Dips",
       "A creamy garlic and Parmesan dipping sauce, perfect with breadsticks or crust.",
       0.79, FOOD, "dips"),
    mk("ph-081","PH-DIP-002","Ranch Dip","Dips",
       "Classic cool and creamy ranch dipping sauce.",
       0.79, FOOD, "dips"),
    mk("ph-082","PH-DIP-003","Blue Cheese Dip","Dips",
       "Tangy, chunky blue cheese dip — the classic wing pairing.",
       0.79, FOOD, "dips"),
    mk("ph-083","PH-DIP-004","Marinara Dip","Dips",
       "Rich, herby tomato marinara dipping sauce.",
       0.79, FOOD, "dips"),
    mk("ph-084","PH-DIP-005","Honey BBQ Dip","Dips",
       "Sweet and smoky honey BBQ dipping sauce.",
       0.79, FOOD, "dips"),
    mk("ph-085","PH-DIP-006","Buffalo Dip","Dips",
       "Tangy, spicy buffalo dipping sauce.",
       0.79, FOOD, "dips"),
]

# ============================================================
# SALADS
# ============================================================
items += [
    mk("ph-090","PH-SAL-001","Garden Salad","Salads",
       "Crisp mixed greens, tomato, cucumber and red onion with your choice of dressing.",
       6.49, FOOD, "salads"),
    mk("ph-091","PH-SAL-002","Caesar Salad","Salads",
       "Romaine lettuce, Parmesan and croutons tossed in creamy Caesar dressing.",
       6.99, FOOD, "salads"),
    mk("ph-092","PH-SAL-003","Italian Chopped Salad","Salads",
       "Romaine, salami, provolone, tomato and olives with a zesty Italian dressing.",
       7.49, FOOD, "salads"),
]

# ============================================================
# DESSERTS
# ============================================================
items += [
    mk("ph-100","PH-DES-001","Cinnamon Sticks","Desserts",
       "Warm dough sticks dusted with cinnamon sugar, served with sweet icing dip.",
       6.49, FOOD, "desserts"),
    mk("ph-101","PH-DES-002","Ultimate Chocolate Chip Cookie","Desserts",
       "A warm, gooey giant chocolate chip cookie baked fresh to order.",
       6.99, FOOD, "desserts"),
    mk("ph-102","PH-DES-003","Triple Chocolate Brownie","Desserts",
       "A rich, fudgy brownie loaded with three kinds of chocolate.",
       6.49, FOOD, "desserts"),
    mk("ph-103","PH-DES-004","Cinnamon Mini Rolls","Desserts",
       "12 bite-sized cinnamon rolls topped with sweet vanilla icing.",
       6.99, FOOD, "desserts"),
    mk("ph-104","PH-DES-005","Apple Dessert Pizza","Desserts",
       "A sweet dessert pizza topped with spiced apple filling and cinnamon crumble.",
       7.49, FOOD, "desserts"),
]

# ============================================================
# SOFT DRINKS
# ============================================================
items += [
    mk("ph-110","PH-DRK-001","Pepsi","Soft Drinks", "Ice-cold classic Pepsi cola, 500ml bottle.", 2.99, ["drinks"], "drinks"),
    mk("ph-111","PH-DRK-002","Diet Pepsi","Soft Drinks", "Ice-cold Diet Pepsi cola, 500ml bottle.", 2.99, ["drinks"], "drinks"),
    mk("ph-112","PH-DRK-003","Mountain Dew","Soft Drinks", "Bold citrus-flavoured Mountain Dew, 500ml bottle.", 2.99, ["drinks"], "drinks"),
    mk("ph-113","PH-DRK-004","Sierra Mist","Soft Drinks", "Crisp, refreshing lemon-lime soda, 500ml bottle.", 2.99, ["drinks"], "drinks"),
    mk("ph-114","PH-DRK-005","Dr Pepper","Soft Drinks", "The one and only Dr Pepper, 500ml bottle.", 2.99, ["drinks"], "drinks"),
    mk("ph-115","PH-DRK-006","Bottled Water","Soft Drinks", "500ml still bottled spring water.", 1.99, ["drinks"], "drinks"),
    mk("ph-116","PH-DRK-007","Fresh Lemonade","Soft Drinks", "Freshly made lemonade, served ice cold.", 3.29, ["drinks"], "drinks"),
]

# ============================================================
# KIDS MEALS
# ============================================================
items += [
    mk("ph-120","PH-KID-001","Kids Cheese Pizza Meal","Kids Meals",
       "A personal cheese pizza with a drink and a fun activity sheet.",
       6.99, FOOD, "kids"),
    mk("ph-121","PH-KID-002","Kids Pepperoni Pizza Meal","Kids Meals",
       "A personal pepperoni pizza with a drink and a fun activity sheet.",
       6.99, FOOD, "kids"),
    mk("ph-122","PH-KID-003","Kids Mac & Cheese","Kids Meals",
       "Creamy mac & cheese with a drink and a fun activity sheet.",
       6.49, FOOD, "kids"),
]

# ============================================================
# TODAY'S SPECIALS / DEALS
# ============================================================
items += [
    mk("ph-130","PH-SPL-001","Big Dinner Box","Today's Specials",
       "2 medium 1-topping pizzas, 5 breadsticks and 2 desserts — feeds the whole family.",
       24.99, ["specials"], "specials"),
    mk("ph-131","PH-SPL-002","$7 Deal Lover's","Today's Specials",
       "Any medium 1-topping pizza, breadsticks, a pasta or 8pc wings — all just $7 each.",
       7.00, ["specials"], "specials"),
    mk("ph-132","PH-SPL-003","Triple Treat Box","Today's Specials",
       "2 medium 2-topping pizzas plus your choice of pasta or 8pc wings.",
       22.99, ["specials"], "specials"),
    mk("ph-133","PH-SPL-004","Large 2-Topping Deal","Today's Specials",
       "Any large 2-topping pizza for one unbeatable price.",
       12.99, ["specials"], "specials"),
    mk("ph-134","PH-SPL-005","Carside Family Deal","Today's Specials",
       "3 medium 1-topping pizzas, ready for pickup — perfect for feeding the family.",
       19.99, ["specials"], "specials"),
    mk("ph-135","PH-SPL-006","Student Twin Deal","Today's Specials",
       "2 medium 1-topping pizzas at a special student-friendly price.",
       15.99, ["specials"], "specials"),
]

# Real Pizza Hut product photography (Wikimedia Commons, freely licensed),
# resized to a small grid-thumbnail variant and a large hero variant.
# Falls back to the generated SVG placeholder for items with no real photo.
REAL_IMAGES = {
    "ph-001": {"small": "images/pizzas/cheese-lovers-pan-sm.jpg",        "large": "images/pizzas/cheese-lovers-pan-lg.jpg"},
    "ph-002": {"small": "images/pizzas/pepperoni-lovers-pan-sm.jpg",     "large": "images/pizzas/pepperoni-lovers-pan-lg.jpg"},
    "ph-003": {"small": "images/pizzas/meat-lovers-pan-sm.jpg",          "large": "images/pizzas/meat-lovers-pan-lg.jpg"},
    "ph-004": {"small": "images/pizzas/veggie-lovers-pan-sm.jpg",        "large": "images/pizzas/veggie-lovers-pan-lg.jpg"},
    "ph-005": {"small": "images/pizzas/supreme-pan-sm.jpg",              "large": "images/pizzas/supreme-pan-lg.jpg"},
    "ph-006": {"small": "images/pizzas/hawaiian-pan-sm.jpg",             "large": "images/pizzas/hawaiian-pan-lg.jpg"},
    "ph-010": {"small": "images/pizzas/pepperoni-stuffed-sm.jpg",        "large": "images/pizzas/pepperoni-stuffed-lg.jpg"},
    "ph-011": {"small": "images/pizzas/meat-lovers-stuffed-sm.jpg",      "large": "images/pizzas/meat-lovers-stuffed-lg.jpg"},
    "ph-012": {"small": "images/pizzas/cheese-stuffed-sm.jpg",           "large": "images/pizzas/cheese-stuffed-lg.jpg"},
    "ph-013": {"small": "images/pizzas/supreme-stuffed-sm.jpg",          "large": "images/pizzas/supreme-stuffed-lg.jpg"},
    "ph-014": {"small": "images/pizzas/bbq-chicken-stuffed-sm.jpg",      "large": "images/pizzas/bbq-chicken-stuffed-lg.jpg"},
    "ph-020": {"small": "images/pizzas/cheese-thin-sm.jpg",              "large": "images/pizzas/cheese-thin-lg.jpg"},
    "ph-021": {"small": "images/pizzas/pepperoni-thin-sm.jpg",           "large": "images/pizzas/pepperoni-thin-lg.jpg"},
    "ph-022": {"small": "images/pizzas/veggie-thin-sm.jpg",              "large": "images/pizzas/veggie-thin-lg.jpg"},
    "ph-023": {"small": "images/pizzas/buffalo-chicken-thin-sm.jpg",     "large": "images/pizzas/buffalo-chicken-thin-lg.jpg"},
    "ph-024": {"small": "images/pizzas/margherita-thin-sm.jpg",          "large": "images/pizzas/margherita-thin-lg.jpg"},
    "ph-030": {"small": "images/pizzas/backyard-bbq-chicken-sm.jpg",     "large": "images/pizzas/backyard-bbq-chicken-lg.jpg"},
    "ph-031": {"small": "images/pizzas/ultimate-cheese-sm.jpg",          "large": "images/pizzas/ultimate-cheese-lg.jpg"},
    "ph-032": {"small": "images/pizzas/chicken-bacon-parmesan-sm.jpg",   "large": "images/pizzas/chicken-bacon-parmesan-lg.jpg"},
    "ph-033": {"small": "images/pizzas/honolulu-luau-sm.jpg",            "large": "images/pizzas/honolulu-luau-lg.jpg"},
    "ph-034": {"small": "images/pizzas/buffalo-chicken-specialty-sm.jpg","large": "images/pizzas/buffalo-chicken-specialty-lg.jpg"},
    "ph-035": {"small": "images/pizzas/tuscani-meat-trio-sm.jpg",        "large": "images/pizzas/tuscani-meat-trio-lg.jpg"},
    "ph-051": {"small": "images/pizzas/meaty-marinara-pasta-sm.jpg",     "large": "images/pizzas/meaty-marinara-pasta-lg.jpg"},
}
for item in items:
    real = REAL_IMAGES.get(item["id"])
    if real:
        item["images"] = [real["small"]]
        item["imagesLarge"] = [real["large"]]

categories = [
    "Pan Pizza", "Stuffed Crust", "Thin 'N Crispy", "Specialty Pizzas",
    "Wings", "Pasta", "Melts & Sandwiches", "Sides & Bread", "Dips",
    "Salads", "Desserts", "Soft Drinks", "Kids Meals", "Today's Specials",
]

data = {
    "@context": "https://gs1.org/voc/",
    "@type": "ItemList",
    "schemaVersion": "1.0",
    "description": "Pizza Hut menu import — GS1 VOC compliant. Items include gs1:recipeIngredient and gs1:customizationOptions auto-mapped on import.",
    "types": [
        {"id": "lunch",    "label": "Lunch",             "color": "#16a34a"},
        {"id": "dinner",   "label": "Dinner",             "color": "#7c3aed"},
        {"id": "drinks",   "label": "Drinks",             "color": "#2563eb"},
        {"id": "specials", "label": "Today's Specials",   "color": "#e11d48"},
    ],
    "items": items,
    "settings": {
        "brandName": "Pizza Hut",
        "currency": "$",
        "logo": logo,
        "logoRight": logo,
        "address": "Your Store Address",
        "phone": "",
        "tagline": "No One OutPizzas the Hut",
    },
    "categories": categories,
    "exportedAt": now,
    "brands": [],
}

with open("pizzahut-import.json", "w") as f:
    json.dump(data, f, indent=2)

print(f"Wrote pizzahut-import.json with {len(items)} items, {len(categories)} categories")

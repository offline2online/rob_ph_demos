#!/usr/bin/env python3
"""Generate starbucks-import.json with all menu items, categories, and embedded SVG images."""
import json, base64, datetime

def b64svg(svg_str):
    return "data:image/svg+xml;base64," + base64.b64encode(svg_str.encode("utf-8")).decode("utf-8")

def card_svg(icon, label, bg="#006241", accent="#CBA258"):
    return b64svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">'
        '<rect width="400" height="300" fill="' + bg + '" rx="12"/>'
        '<rect x="8" y="8" width="384" height="284" fill="none" stroke="' + accent + '" stroke-width="3" rx="9"/>'
        '<text x="200" y="155" font-family="Segoe UI Emoji,Apple Color Emoji,Noto Emoji,Arial" '
        'font-size="110" text-anchor="middle" dominant-baseline="middle">' + icon + '</text>'
        '<text x="200" y="245" font-family="Arial,Helvetica,sans-serif" '
        'font-size="21" font-weight="bold" text-anchor="middle" fill="' + accent + '" letter-spacing="2">' + label + '</text>'
        '</svg>'
    )

imgs = {
    "hot_coffee":          card_svg("\u2615", "HOT COFFEE",        "#006241", "#CBA258"),
    "cold_drinks":         card_svg("\U0001f9ca", "COLD DRINKS",      "#1E3932", "#CBA258"),
    "frappuccino":         card_svg("\U0001f9cb", "FRAPPUCCINO",      "#006241", "#CBA258"),
    "refresher":           card_svg("\U0001f379", "REFRESHERS",       "#0D6E50", "#CBA258"),
    "tea":                 card_svg("\U0001f375", "TEA",              "#1E3932", "#CBA258"),
    "breakfast_sandwich":  card_svg("\U0001f96a", "BREAKFAST SANDWICH","#4A3728", "#F5D7A3"),
    "breakfast_wrap":      card_svg("\U0001f32f", "BREAKFAST WRAP",   "#5C4033", "#F5D7A3"),
    "egg_bites":           card_svg("\U0001f95a", "EGG BITES",       "#4A3728", "#F5D7A3"),
    "pastry":              card_svg("\U0001f950", "PASTRY",           "#7B5430", "#F5D7A3"),
    "bakery":              card_svg("\U0001f9c1", "BAKERY",           "#8B6347", "#F5D7A3"),
    "sweet":               card_svg("\U0001f36d", "SWEET TREATS",     "#7B5430", "#F5D7A3"),
    "protein_box":         card_svg("\U0001f4e6", "PROTEIN BOX",      "#2D4A3E", "#CBA258"),
    "sandwich":            card_svg("\U0001f969", "SANDWICHES",       "#4A3728", "#F5D7A3"),
    "oatmeal":             card_svg("\U0001f963", "OATMEAL",          "#7B5430", "#F5D7A3"),
    "salad_bowl":          card_svg("\U0001f957", "SALAD BOWL",       "#1E3932", "#CBA258"),
    "seasonal":            card_svg("\u2b50",     "SEASONAL SPECIAL", "#8B1A1A", "#F5D7A3"),
    "cold_brew":           card_svg("\u2615\ufe0f", "COLD BREW",       "#1E3932", "#CBA258"),
}

logo = b64svg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300">'
    '<circle cx="150" cy="150" r="150" fill="#006241"/>'
    '<circle cx="150" cy="150" r="130" fill="none" stroke="#CBA258" stroke-width="5"/>'
    '<circle cx="150" cy="150" r="112" fill="#006241"/>'
    '<text x="150" y="128" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="bold" '
    'text-anchor="middle" fill="#CBA258" letter-spacing="4">STARBUCKS</text>'
    '<text x="150" y="152" font-family="Arial,Helvetica,sans-serif" font-size="11" '
    'text-anchor="middle" fill="#CBA258" letter-spacing="3">COFFEE</text>'
    '<text x="150" y="185" font-family="Arial,Helvetica,sans-serif" '
    'font-size="48" text-anchor="middle" dominant-baseline="middle" fill="#CBA258">&#9770;</text>'
    '</svg>'
)

now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def mk(id_, sku, name, cat, desc, price, cal, fat, carbs, prot, types, img_key):
    return {
        "id": id_,
        "sku": sku,
        "name": name,
        "category": cat,
        "description": desc,
        "price": round(float(price), 2),
        "calories": int(cal) if cal is not None else None,
        "fat": float(fat) if fat is not None else None,
        "carbs": float(carbs) if carbs is not None else None,
        "protein": float(prot) if prot is not None else None,
        "menuTypes": types if isinstance(types, list) else [types],
        "images": [imgs[img_key]],
        "active": True,
        "createdAt": now,
        "updatedAt": now,
    }

items = [

    # ============================================================
    # HOT COFFEE
    # ============================================================
    mk("sbx-001","SBX-HC-001","Pike Place Roast","Hot Coffee",
       "Our signature medium roast with smooth, full-bodied flavour of toasted nuts and cocoa. "
       "Brewed fresh every 30 minutes — the coffee Starbucks was built on.",
       3.65, 5, 0.0, 1.0, 0.0, ["drinks"], "hot_coffee"),

    mk("sbx-002","SBX-HC-002","Caffè Americano","Hot Coffee",
       "Bold espresso shots topped with hot water, producing a light crema. "
       "A clean, full-bodied drink with a rich, robust flavour profile.",
       3.75, 15, 0.0, 2.0, 1.0, ["drinks"], "hot_coffee"),

    mk("sbx-003","SBX-HC-003","Caffè Latte","Hot Coffee",
       "Rich, full-bodied espresso in steamed milk with a light layer of foam. "
       "A timeless classic crafted for those who love smooth, milky coffee.",
       4.65, 190, 7.0, 19.0, 13.0, ["drinks"], "hot_coffee"),

    mk("sbx-004","SBX-HC-004","Cappuccino","Hot Coffee",
       "Dark espresso balanced with steamed milk and a deep layer of velvety foam. "
       "A Starbucks hallmark since 1986, loved for its bold espresso character.",
       4.45, 140, 5.0, 14.0, 10.0, ["drinks"], "hot_coffee"),

    mk("sbx-005","SBX-HC-005","Flat White","Hot Coffee",
       "Ristretto espresso with velvety steamed whole milk in a smaller, stronger serving. "
       "An extra-bold take on the classic latte originating from Australia and New Zealand.",
       5.20, 220, 11.0, 17.0, 12.0, ["drinks"], "hot_coffee"),

    mk("sbx-006","SBX-HC-006","Caffè Mocha","Hot Coffee",
       "Full-flavoured espresso combined with bittersweet mocha sauce and steamed milk, "
       "finished with a generous swirl of sweetened whipped cream. Indulgent and rich.",
       5.25, 370, 14.0, 51.0, 14.0, ["drinks"], "hot_coffee"),

    mk("sbx-007","SBX-HC-007","White Chocolate Mocha","Hot Coffee",
       "Espresso meets creamy white chocolate sauce and steamed milk in this beloved classic, "
       "topped with sweetened whipped cream for an irresistibly sweet finish.",
       5.55, 430, 15.0, 61.0, 14.0, ["drinks"], "hot_coffee"),

    mk("sbx-008","SBX-HC-008","Caramel Macchiato","Hot Coffee",
       "Vanilla-flavoured drink with fresh espresso marked with a caramel crosshatch drizzle. "
       "Layered beautifully for a balance of sweet and bold.",
       5.75, 250, 7.0, 34.0, 10.0, ["drinks"], "hot_coffee"),

    mk("sbx-009","SBX-HC-009","Cinnamon Dolce Latte","Hot Coffee",
       "Espresso and steamed milk sweetened with cinnamon dolce syrup, "
       "topped with whipped cream and a dusting of cinnamon dolce sprinkles. Warmly spiced.",
       5.25, 340, 8.0, 52.0, 13.0, ["drinks"], "hot_coffee"),

    mk("sbx-010","SBX-HC-010","Vanilla Latte","Hot Coffee",
       "Smooth espresso with steamed milk elevated by the sweet, creamy taste of classic vanilla syrup. "
       "Simple, satisfying and endlessly drinkable.",
       5.25, 250, 6.0, 35.0, 13.0, ["drinks"], "hot_coffee"),

    mk("sbx-011","SBX-HC-011","Honey Oat Milk Latte","Hot Coffee",
       "Starbucks Blonde® espresso with oat milk, honey blend, and steamed oat milk. "
       "A lightly sweet, creamy latte with a golden honey flavour.",
       5.75, 260, 6.0, 39.0, 7.0, ["drinks"], "hot_coffee"),

    mk("sbx-012","SBX-HC-012","Hazelnut Bianco Latte","Hot Coffee",
       "Blonde espresso shots shaken with hazelnut syrup then poured over ice with oat milk. "
       "Nutty, sweet, and refreshingly light.",
       5.95, 290, 7.0, 41.0, 8.0, ["drinks"], "hot_coffee"),

    # ============================================================
    # ICED COFFEE
    # ============================================================
    mk("sbx-013","SBX-IC-001","Iced Caffè Americano","Iced Coffee",
       "Espresso shots topped with cold water and poured over ice. "
       "Full-bodied and refreshing with that classic espresso boldness.",
       4.25, 15, 0.0, 2.0, 1.0, ["drinks"], "cold_drinks"),

    mk("sbx-014","SBX-IC-002","Iced Caffè Latte","Iced Coffee",
       "Espresso with cold milk poured over ice. "
       "A refreshing mid-day sipper with the smooth taste of our espresso blend.",
       5.25, 130, 5.0, 13.0, 7.0, ["drinks"], "cold_drinks"),

    mk("sbx-015","SBX-IC-003","Iced Caramel Macchiato","Iced Coffee",
       "Vanilla syrup, cold milk, ice, and bold espresso topped with a signature caramel drizzle. "
       "Sweet, indulgent and impossibly refreshing.",
       5.95, 250, 7.0, 35.0, 10.0, ["drinks"], "cold_drinks"),

    mk("sbx-016","SBX-IC-004","Iced White Chocolate Mocha","Iced Coffee",
       "Espresso with white chocolate sauce, cold milk, and ice, "
       "finished with a cloud of sweetened whipped cream. Sweet perfection on ice.",
       5.95, 390, 13.0, 57.0, 10.0, ["drinks"], "cold_drinks"),

    mk("sbx-017","SBX-IC-005","Iced Vanilla Latte","Iced Coffee",
       "Smooth espresso with vanilla syrup shaken with ice and finished with cold milk. "
       "A chilled take on our most beloved classic latte.",
       5.25, 190, 4.5, 28.0, 8.0, ["drinks"], "cold_drinks"),

    mk("sbx-018","SBX-IC-006","Iced Brown Sugar Oat Milk Shaken Espresso","Iced Coffee",
       "Blonde espresso shaken with brown sugar syrup and cinnamon, then poured over oat milk and ice. "
       "Lightly sweet with a warm, spiced edge.",
       5.95, 120, 2.0, 20.0, 3.0, ["drinks"], "cold_drinks"),

    # ============================================================
    # COLD BREW
    # ============================================================
    mk("sbx-019","SBX-CB-001","Cold Brew Coffee","Cold Brew",
       "Steeped in cool water for 20 hours without heat for an ultra-smooth, naturally sweet flavour. "
       "Low acidity, full body — cold coffee perfected.",
       4.45, 5, 0.0, 0.0, 0.0, ["drinks"], "cold_brew"),

    mk("sbx-020","SBX-CB-002","Nitro Cold Brew","Cold Brew",
       "Our signature Cold Brew infused with nitrogen for a cascading, velvety texture. "
       "Served straight from the tap — no ice needed.",
       5.25, 5, 0.0, 0.0, 0.0, ["drinks"], "cold_brew"),

    mk("sbx-021","SBX-CB-003","Salted Caramel Cream Cold Brew","Cold Brew",
       "Cold Brew topped with a float of sweet cream infused with vanilla and a salted caramel drizzle. "
       "The ultimate indulgent cold coffee.",
       5.95, 270, 14.0, 30.0, 3.0, ["drinks"], "cold_brew"),

    mk("sbx-022","SBX-CB-004","Vanilla Sweet Cream Cold Brew","Cold Brew",
       "Cold Brew topped with a velvety float of house-made vanilla sweet cream. "
       "A perfect blend of bold coffee and delicate sweetness.",
       5.25, 110, 6.0, 14.0, 1.0, ["drinks"], "cold_brew"),

    # ============================================================
    # TEA
    # ============================================================
    mk("sbx-023","SBX-TE-001","Chai Tea Latte","Hot Tea",
       "Black tea infused with cinnamon, clove, and warming spices combined with steamed milk and topped with foam. "
       "Spiced, fragrant and comforting.",
       5.25, 240, 4.0, 45.0, 8.0, ["drinks"], "tea"),

    mk("sbx-024","SBX-TE-002","Matcha Green Tea Latte","Hot Tea",
       "Smooth, earthy matcha tea blended with steamed milk for a creamy, vibrant hot tea latte. "
       "Naturally sweetened and energising.",
       5.25, 240, 7.0, 34.0, 12.0, ["drinks"], "tea"),

    mk("sbx-025","SBX-TE-003","Iced Chai Tea Latte","Iced Tea",
       "Black tea with warm cinnamon and spice, sweetened and poured over ice with cold milk. "
       "Spicy, sweet and refreshingly chilled.",
       5.25, 240, 4.5, 45.0, 5.0, ["drinks"], "tea"),

    mk("sbx-026","SBX-TE-004","Iced Matcha Tea Latte","Iced Tea",
       "Smooth, earthy matcha whisked with milk and served over ice. "
       "Bright, grassy flavour with a satisfying natural sweetness.",
       5.25, 200, 5.0, 28.0, 8.0, ["drinks"], "tea"),

    mk("sbx-027","SBX-TE-005","Classic Hot Tea","Hot Tea",
       "A calming pot of premium tea. Choose from Earl Grey, English Breakfast, Mint Majesty, "
       "Jade Citrus Mint, or Peach Tranquility herbal blends.",
       3.25, 0, 0.0, 0.0, 0.0, ["drinks"], "tea"),

    mk("sbx-028","SBX-TE-006","London Fog Tea Latte","Hot Tea",
       "Earl Grey tea infused with vanilla syrup and topped with steamed milk and foam. "
       "A lavender-tinged, aromatic treat beloved by tea lovers.",
       5.25, 200, 7.0, 27.0, 10.0, ["drinks"], "tea"),

    # ============================================================
    # REFRESHERS
    # ============================================================
    mk("sbx-029","SBX-RE-001","Strawberry Açaí Refresher","Refreshers",
       "Sweet strawberry flavours and whole dried strawberries shaken with ice and "
       "Starbucks Refreshers energy — 45mg natural caffeine per serving.",
       5.25, 90, 0.0, 22.0, 0.0, ["drinks"], "refresher"),

    mk("sbx-030","SBX-RE-002","Mango Dragonfruit Refresher","Refreshers",
       "Tropical mango flavours with a vibrant magenta colour from real dragon fruit pieces, "
       "shaken with ice for a refreshing fruity boost.",
       5.25, 90, 0.0, 22.0, 0.0, ["drinks"], "refresher"),

    mk("sbx-031","SBX-RE-003","Pink Drink","Refreshers",
       "Strawberry Açaí Refresher meets coconut milk for a light, creamy iced beverage "
       "with a fresh, fruity taste and beautiful blush colour.",
       5.75, 140, 2.5, 27.0, 1.0, ["drinks"], "refresher"),

    mk("sbx-032","SBX-RE-004","Pineapple Passionfruit Refresher","Refreshers",
       "Tropical pineapple and passionfruit flavours shaken with ice and pineapple pieces. "
       "Bright, citrusy and seriously refreshing.",
       5.25, 80, 0.0, 20.0, 0.0, ["drinks"], "refresher"),

    mk("sbx-033","SBX-RE-005","Paradise Drink","Refreshers",
       "Pineapple Passionfruit Refresher meets creamy coconut milk for a tropical, "
       "island-inspired iced beverage with sunny pineapple flavours.",
       5.75, 140, 2.5, 26.0, 1.0, ["drinks"], "refresher"),

    # ============================================================
    # FRAPPUCCINOS
    # ============================================================
    mk("sbx-034","SBX-FR-001","Caramel Frappuccino","Frappuccino",
       "Buttery caramel sauce blended with coffee, ice, and milk, topped with "
       "sweetened whipped cream and a caramel drizzle. The classic crowd-pleaser.",
       5.75, 380, 14.0, 59.0, 5.0, ["drinks"], "frappuccino"),

    mk("sbx-035","SBX-FR-002","Java Chip Frappuccino","Frappuccino",
       "Mocha sauce and Frappuccino chips blended with coffee, milk, and ice, "
       "finished with whipped cream and a mocha drizzle. For the true chocoholic.",
       5.75, 440, 18.0, 64.0, 5.0, ["drinks"], "frappuccino"),

    mk("sbx-036","SBX-FR-003","Mocha Frappuccino","Frappuccino",
       "Mocha sauce blended with Frappuccino roast coffee, milk, and ice. "
       "Topped with sweetened whipped cream. Chocolatey and refreshing.",
       5.25, 370, 12.0, 59.0, 5.0, ["drinks"], "frappuccino"),

    mk("sbx-037","SBX-FR-004","Strawberry Crème Frappuccino","Frappuccino",
       "Strawberry purée layered with vanilla and milk, blended with ice and "
       "finished with whipped cream. A delightful crème Frappuccino — no coffee.",
       5.25, 370, 11.0, 61.0, 5.0, ["drinks"], "frappuccino"),

    mk("sbx-038","SBX-FR-005","Vanilla Bean Crème Frappuccino","Frappuccino",
       "Pure vanilla flavour blended with milk and ice, topped with sweetened whipped cream. "
       "Sweet, simple and utterly satisfying — crème base, no coffee.",
       5.25, 390, 14.0, 63.0, 5.0, ["drinks"], "frappuccino"),

    mk("sbx-039","SBX-FR-006","White Chocolate Crème Frappuccino","Frappuccino",
       "White chocolate sauce blended with milk and ice, topped with sweetened whipped cream. "
       "A decadently rich crème-based Frappuccino for white chocolate lovers.",
       5.75, 430, 15.0, 66.0, 5.0, ["drinks"], "frappuccino"),

    mk("sbx-040","SBX-FR-007","Matcha Crème Frappuccino","Frappuccino",
       "Sweet matcha tea blended with milk and ice, topped with sweetened whipped cream. "
       "An earthy, vibrant crème Frappuccino with a naturally beautiful green hue.",
       5.25, 420, 15.0, 64.0, 6.0, ["drinks"], "frappuccino"),

    mk("sbx-041","SBX-FR-008","Caramel Ribbon Crunch Frappuccino","Frappuccino",
       "Dark caramel coffee Frappuccino with ribbon of caramel sauce, whipped cream, "
       "caramel drizzle, and caramel sugar crystals. A layered masterpiece.",
       6.25, 470, 17.0, 72.0, 5.0, ["drinks"], "frappuccino"),

    # ============================================================
    # SEASONAL SPECIALS
    # ============================================================
    mk("sbx-042","SBX-SP-001","Pumpkin Spice Latte","Seasonal Coffee",
       "Our iconic autumn favourite — espresso with pumpkin, cinnamon, nutmeg, and clove, "
       "finished with steamed milk and whipped cream dusted in pumpkin spice. Fall in a cup.",
       6.45, 380, 13.0, 52.0, 14.0, ["drinks", "specials"], "seasonal"),

    mk("sbx-043","SBX-SP-002","Peppermint Mocha","Seasonal Coffee",
       "Rich espresso with bittersweet mocha sauce and peppermint-flavoured syrup, "
       "topped with whipped cream and dark chocolate curls. Holiday indulgence.",
       6.45, 440, 16.0, 64.0, 14.0, ["drinks", "specials"], "seasonal"),

    mk("sbx-044","SBX-SP-003","Caramel Brulée Latte","Seasonal Coffee",
       "Espresso with caramel brulée sauce and steamed milk, topped with whipped cream "
       "and caramel brulée topping. A festive, caramel-forward holiday treat.",
       6.45, 450, 15.0, 64.0, 15.0, ["drinks", "specials"], "seasonal"),

    mk("sbx-045","SBX-SP-004","Toasted White Chocolate Mocha","Seasonal Coffee",
       "Espresso with toasted white chocolate-flavoured sauce and steamed milk, "
       "finished with whipped cream and a festive topping. A holiday Starbucks staple.",
       6.45, 420, 14.0, 61.0, 13.0, ["drinks", "specials"], "seasonal"),

    mk("sbx-046","SBX-SP-005","Eggnog Latte","Seasonal Coffee",
       "Rich espresso combined with creamy eggnog and steamed milk, dusted with fragrant nutmeg. "
       "A classic holiday latte available only in the festive season.",
       6.45, 450, 18.0, 55.0, 17.0, ["drinks", "specials"], "seasonal"),

    mk("sbx-047","SBX-SP-006","Iced Pumpkin Cream Cold Brew","Seasonal Coffee",
       "Cold Brew sweetened with vanilla syrup, topped with silky pumpkin cream cold foam "
       "and pumpkin spice topping. A chilled autumn dream.",
       6.45, 250, 11.0, 31.0, 5.0, ["drinks", "specials"], "seasonal"),

    mk("sbx-048","SBX-SP-007","Cranberry Bliss Bar","Seasonal Treats",
       "A golden blondie bar topped with lemon cream cheese frosting, dried cranberries, "
       "and a white chocolate drizzle. A beloved holiday treat.",
       3.95, 320, 15.0, 43.0, 4.0, ["specials"], "seasonal"),

    mk("sbx-049","SBX-SP-008","Pumpkin Cream Cheese Muffin","Seasonal Treats",
       "A double-topped muffin with real pumpkin cream cheese filling and crunchy pepitas "
       "on top. Moist, spiced perfection for the autumn season.",
       3.95, 390, 15.0, 57.0, 6.0, ["breakfast", "specials"], "seasonal"),

    mk("sbx-050","SBX-SP-009","Pumpkin Loaf","Seasonal Treats",
       "A moist, tender pumpkin loaf made with real pumpkin, cinnamon, and warm spices. "
       "A comforting seasonal slice to enjoy with your favourite hot beverage.",
       3.95, 390, 14.0, 63.0, 5.0, ["breakfast", "specials"], "seasonal"),

    # ============================================================
    # BREAKFAST SANDWICHES
    # ============================================================
    mk("sbx-051","SBX-BK-001","Bacon, Gouda & Egg Sandwich","Breakfast Sandwich",
       "Thick-cut, peppered bacon with a fried cage-free egg and aged Gouda cheese "
       "on a toasted artisan roll. A hearty breakfast favourite.",
       5.25, 370, 19.0, 32.0, 20.0, ["breakfast"], "breakfast_sandwich"),

    mk("sbx-052","SBX-BK-002","Sausage, Cheddar & Egg Sandwich","Breakfast Sandwich",
       "Savory pork sausage patty with a fried egg and sharp cheddar cheese "
       "on a warm croissant bun. Comfort food at its finest.",
       4.95, 500, 31.0, 41.0, 20.0, ["breakfast"], "breakfast_sandwich"),

    mk("sbx-053","SBX-BK-003","Turkey Bacon, Cheddar & Egg White Sandwich","Breakfast Sandwich",
       "Lean turkey bacon with cage-free egg whites and reduced-fat cheddar on an English muffin. "
       "A lighter morning option without compromising flavour.",
       4.95, 230, 6.0, 27.0, 18.0, ["breakfast"], "breakfast_sandwich"),

    mk("sbx-054","SBX-BK-004","Double-Smoked Bacon, Cheddar & Egg Sandwich","Breakfast Sandwich",
       "Double-smoked bacon layered with a fried egg and aged white cheddar on a toasted croissant bun. "
       "Bold, hearty and unapologetically satisfying.",
       5.75, 500, 27.0, 42.0, 26.0, ["breakfast"], "breakfast_sandwich"),

    mk("sbx-055","SBX-BK-005","Ham & Swiss Croissant","Breakfast Sandwich",
       "Sliced black forest ham with melted Swiss cheese on a warm, flaky butter croissant. "
       "A classic European-inspired breakfast pairing.",
       5.75, 400, 20.0, 36.0, 22.0, ["breakfast"], "breakfast_sandwich"),

    # ============================================================
    # BREAKFAST WRAPS
    # ============================================================
    mk("sbx-056","SBX-BW-001","Spinach, Feta & Egg White Wrap","Breakfast Wrap",
       "Cage-free egg whites with spinach, tomatoes, and feta cheese wrapped in a "
       "whole wheat tortilla. Light, protein-packed and nutritiously satisfying.",
       5.25, 290, 10.0, 33.0, 20.0, ["breakfast"], "breakfast_wrap"),

    mk("sbx-057","SBX-BW-002","Chicken Sausage & Egg Wrap","Breakfast Wrap",
       "Savoury chicken sausage with cage-free egg whites, spinach, and tomatoes "
       "wrapped in a warm whole wheat flour tortilla. Lean and filling.",
       5.75, 250, 7.0, 28.0, 22.0, ["breakfast"], "breakfast_wrap"),

    # ============================================================
    # EGG BITES
    # ============================================================
    mk("sbx-058","SBX-EB-001","Bacon & Gruyère Egg Bites","Egg Bites",
       "Applewood-smoked bacon and smooth Gruyère cheese in a fluffy sous vide egg bite. "
       "High-protein, low-carb and impossibly creamy. Two per serving.",
       5.25, 310, 21.0, 9.0, 19.0, ["breakfast"], "egg_bites"),

    mk("sbx-059","SBX-EB-002","Egg White & Red Pepper Egg Bites","Egg Bites",
       "Cage-free egg whites with roasted red pepper, cottage cheese, and Monterey Jack "
       "in a sous vide egg bite. Light, airy and packed with protein.",
       5.25, 170, 6.0, 13.0, 13.0, ["breakfast"], "egg_bites"),

    mk("sbx-060","SBX-EB-003","Kale & Mushroom Egg Bites","Egg Bites",
       "Egg whites with tender kale, roasted mushrooms, and aged Gouda in a sous vide egg bite. "
       "Wholesome vegetables meet satisfying protein in every bite.",
       5.25, 140, 7.0, 9.0, 11.0, ["breakfast"], "egg_bites"),

    # ============================================================
    # PASTRIES & BAKERY
    # ============================================================
    mk("sbx-061","SBX-PA-001","Butter Croissant","Pastry",
       "A light and flaky all-butter croissant made with real butter and perfectly laminated layers. "
       "Golden, delicate, and classically French.",
       3.45, 260, 15.0, 27.0, 5.0, ["breakfast"], "pastry"),

    mk("sbx-062","SBX-PA-002","Chocolate Croissant","Pastry",
       "A classic butter croissant with rich, dark chocolate baked inside. "
       "Flaky, buttery pastry meets indulgent cocoa in every mouthful.",
       3.45, 340, 19.0, 35.0, 7.0, ["breakfast"], "pastry"),

    mk("sbx-063","SBX-PA-003","Blueberry Scone","Pastry",
       "A crumbly, buttery scone studded with plump blueberries, finished with a sweet icing drizzle. "
       "A satisfying British-inspired breakfast bake.",
       3.45, 440, 14.0, 71.0, 6.0, ["breakfast"], "pastry"),

    mk("sbx-064","SBX-PA-004","Banana Nut Bread","Bakery",
       "Moist, tender banana bread packed with walnuts and the natural sweetness of real bananas. "
       "A comforting, classic bake loved for generations.",
       3.45, 420, 22.0, 55.0, 6.0, ["breakfast"], "bakery"),

    mk("sbx-065","SBX-PA-005","Blueberry Muffin","Bakery",
       "A generously-sized golden muffin bursting with fresh blueberries throughout. "
       "Moist and fluffy with a lightly crisp crown.",
       3.45, 360, 16.0, 51.0, 5.0, ["breakfast"], "bakery"),

    mk("sbx-066","SBX-PA-006","Plain Bagel with Cream Cheese","Bakery",
       "A classic plain bagel toasted to perfection and served with a generous "
       "portion of smooth cream cheese. A simple, satisfying staple.",
       3.25, 390, 9.0, 68.0, 12.0, ["breakfast"], "bakery"),

    mk("sbx-067","SBX-PA-007","Iced Lemon Loaf","Bakery",
       "A moist, zesty lemon-flavoured loaf cake topped with a lemon icing. "
       "The perfect sweet slice to complement your favourite Starbucks beverage.",
       3.95, 500, 23.0, 68.0, 6.0, ["breakfast", "lunch"], "bakery"),

    mk("sbx-068","SBX-PA-008","Birthday Cake Pop","Sweet Treats",
       "Moist vanilla cake mixed with icing, dipped in pink chocolatey coating "
       "and finished with white sprinkles. A festive little celebration.",
       3.50, 170, 9.0, 22.0, 2.0, ["breakfast", "lunch", "specials"], "sweet"),

    mk("sbx-069","SBX-PA-009","Marshmallow Dream Bar","Sweet Treats",
       "The nostalgic crunch of a rice crispy treat reimagined with Starbucks quality. "
       "Sweet, chewy, and impossibly satisfying.",
       2.95, 230, 4.5, 45.0, 2.0, ["breakfast", "lunch"], "sweet"),

    # ============================================================
    # OATMEAL
    # ============================================================
    mk("sbx-070","SBX-OA-001","Classic Whole Grain Oatmeal","Oatmeal",
       "Hearty whole grain rolled oats served with your choice of toppings: "
       "a nut medley, dried fruit, and brown sugar. A wholesome, warming start.",
       3.95, 160, 2.5, 28.0, 5.0, ["breakfast"], "oatmeal"),

    mk("sbx-071","SBX-OA-002","Strawberry Overnight Grains","Grains",
       "A chilled whole grain blend with strawberries, honey, and sunflower seeds. "
       "Ready-to-eat and packed with fibre and nutrition.",
       4.95, 220, 3.5, 42.0, 7.0, ["breakfast"], "oatmeal"),

    # ============================================================
    # PROTEIN BOXES
    # ============================================================
    mk("sbx-072","SBX-PB-001","Eggs & Cheddar Protein Box","Protein Box",
       "Cage-free hard-boiled eggs, reduced-fat white cheddar, multigrain muesli bread, "
       "honey peanut butter, and seasonal fruit. A balanced, protein-packed meal.",
       6.45, 470, 23.0, 47.0, 24.0, ["breakfast", "lunch"], "protein_box"),

    mk("sbx-073","SBX-PB-002","PB&J Protein Box","Protein Box",
       "Classic peanut butter and strawberry jam with a sesame bagel, seasonal fruit, "
       "and a hard-boiled egg. Childhood nostalgia, elevated.",
       5.95, 540, 22.0, 70.0, 18.0, ["breakfast", "lunch"], "protein_box"),

    mk("sbx-074","SBX-PB-003","Grilled Chicken & Hummus Protein Box","Protein Box",
       "Grilled chicken strips with roasted red pepper hummus, white cheddar, "
       "seasonal fruit, and multigrain crackers. Filling, flavourful and high-protein.",
       6.95, 480, 21.0, 45.0, 30.0, ["lunch"], "protein_box"),

    mk("sbx-075","SBX-PB-004","Cheese & Fruit Protein Box","Protein Box",
       "Reduced-fat white cheddar and smoked Gouda with seasonal fruit, "
       "honey peanut butter, and multigrain crackers. The perfect afternoon pick-me-up.",
       5.95, 480, 22.0, 52.0, 18.0, ["lunch"], "protein_box"),

    mk("sbx-076","SBX-PB-005","Edamame & Egg Protein Box","Protein Box",
       "Cage-free hard-boiled egg with shelled edamame, grape tomatoes, carrots, "
       "mini Babybel cheese, and rice crackers. Light, nutritious and satisfying.",
       6.45, 340, 14.0, 31.0, 18.0, ["breakfast", "lunch"], "protein_box"),

    # ============================================================
    # LUNCH & DINNER SANDWICHES
    # ============================================================
    mk("sbx-077","SBX-LU-001","Turkey & Basil Pesto Sandwich","Sandwich",
       "Sliced turkey breast with basil pesto on toasted multigrain bread, "
       "layered with tomatoes, spinach, and havarti cheese. Fresh and flavourful.",
       7.95, 500, 21.0, 53.0, 29.0, ["lunch", "dinner"], "sandwich"),

    mk("sbx-078","SBX-LU-002","Chicken & Double Smoked Bacon Sandwich","Sandwich",
       "Tender chicken breast with double-smoked bacon, havarti cheese, tomato, "
       "and chipotle aioli on toasted sourdough. Bold, smoky and hearty.",
       8.45, 580, 28.0, 50.0, 35.0, ["lunch", "dinner"], "sandwich"),

    mk("sbx-079","SBX-LU-003","Ham & Swiss Panini","Sandwich",
       "Black forest ham with Swiss cheese pressed on toasted ciabatta "
       "with wholegrain mustard and lettuce. A warm, European-inspired classic.",
       7.95, 500, 21.0, 51.0, 28.0, ["lunch", "dinner"], "sandwich"),

    mk("sbx-080","SBX-LU-004","Chicken BLT Salad Sandwich","Sandwich",
       "Juicy chicken breast with crispy bacon, romaine lettuce, and tomatoes "
       "tossed with ranch dressing on toasted artisan bread.",
       8.45, 510, 18.0, 55.0, 31.0, ["lunch", "dinner"], "sandwich"),

    # ============================================================
    # SALAD BOWLS
    # ============================================================
    mk("sbx-081","SBX-SB-001","Zesty Chicken & Black Bean Salad Bowl","Salad Bowl",
       "Grilled chicken with black beans, roasted corn, pepitas, and queso fresco "
       "on a bed of hearty greens with a zesty lime vinaigrette.",
       8.95, 420, 11.0, 52.0, 28.0, ["lunch", "dinner"], "salad_bowl"),

    mk("sbx-082","SBX-SB-002","Caesar Salad with Chicken","Salad Bowl",
       "Crisp romaine lettuce topped with grilled chicken, Parmesan shavings, "
       "croutons, and a classic Caesar dressing. A timeless lunch staple.",
       8.45, 380, 18.0, 24.0, 30.0, ["lunch", "dinner"], "salad_bowl"),

]

categories = [
    {"id": "cat-01", "name": "Hot Coffee",           "description": "Classic and signature hot espresso beverages"},
    {"id": "cat-02", "name": "Iced Coffee",           "description": "Espresso-based beverages served cold over ice"},
    {"id": "cat-03", "name": "Cold Brew",             "description": "Slow-steeped cold brew and nitro beverages"},
    {"id": "cat-04", "name": "Hot Tea",               "description": "Premium hot tea and tea latte beverages"},
    {"id": "cat-05", "name": "Iced Tea",              "description": "Refreshing iced teas and tea lattes"},
    {"id": "cat-06", "name": "Refreshers",            "description": "Fruit-forward Starbucks Refreshers energy drinks"},
    {"id": "cat-07", "name": "Frappuccino",           "description": "Blended Frappuccino® beverages, coffee and crème bases"},
    {"id": "cat-08", "name": "Seasonal Coffee",       "description": "Limited-time seasonal espresso specials"},
    {"id": "cat-09", "name": "Seasonal Treats",       "description": "Limited-time seasonal food and bakery items"},
    {"id": "cat-10", "name": "Breakfast Sandwich",    "description": "Warm, freshly prepared breakfast sandwiches"},
    {"id": "cat-11", "name": "Breakfast Wrap",        "description": "Light and nutritious cage-free egg breakfast wraps"},
    {"id": "cat-12", "name": "Egg Bites",             "description": "Sous vide egg bites — high protein, low carb"},
    {"id": "cat-13", "name": "Pastry",                "description": "Freshly baked pastries and sweet breads"},
    {"id": "cat-14", "name": "Bakery",                "description": "Freshly baked muffins, loaves, and breads"},
    {"id": "cat-15", "name": "Sweet Treats",          "description": "Cake pops, bars, and sweet grab-and-go snacks"},
    {"id": "cat-16", "name": "Protein Box",           "description": "Balanced, protein-packed snack and meal boxes"},
    {"id": "cat-17", "name": "Sandwich",              "description": "Savoury lunch and dinner sandwiches and paninis"},
    {"id": "cat-18", "name": "Oatmeal",               "description": "Whole grain oatmeal served with toppings"},
    {"id": "cat-19", "name": "Grains",                "description": "Nutritious whole grain cold breakfast options"},
    {"id": "cat-20", "name": "Salad Bowl",            "description": "Fresh, hearty salad bowls with premium toppings"},
]

settings = {
    "brandName": "Starbucks",
    "currency": "$",
    "logo": logo,
    "logoRight": logo,
    "address": "Your Store Address",
    "phone": "",
    "tagline": "Inspiring and Nurturing the Human Spirit",
}

output = {
    "items": items,
    "settings": settings,
    "categories": categories,
    "exportedAt": now,
}

out_path = "/Users/rgeerdink/Documents/Claude Code/starbucks-import.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"SUCCESS: Written {len(items)} items, {len(categories)} categories to:")
print(f"  {out_path}")

import os
size_kb = os.path.getsize(out_path) / 1024
print(f"  File size: {size_kb:.1f} KB")

menu_types = {}
for it in items:
    for mt in it["menuTypes"]:
        menu_types[mt] = menu_types.get(mt, 0) + 1
print("\nItems per menu type:")
for mt, count in sorted(menu_types.items()):
    print(f"  {mt}: {count} items")

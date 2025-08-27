# Accessory Management Test

This document describes how to test the accessory management system.

## Manual Testing Steps

1. **Open BlobbiInfoModal**: Click on your Blobbi to open the info modal.

2. **Navigate to Inventory Tab**: Click on the "Inventory" tab in the modal.

3. **Test Empty State**: You should see an empty state message if you don't have any accessories yet.

4. **Add Sample Accessories**: To test the system, you can manually add some inventory tags to your kind 31125 event. Here are some example tags you can add:

   ```json
   ["inv", "headwear-8", "qty", "2", "url", "https://danidfra.github.io/blobbi-designs/accessories/headwear/headwear-8.png", "ver", "1"]
   ["inv", "eyewear-2", "qty", "3", "url", "https://danidfra.github.io/blobbi-designs/accessories/eyewear/eyewear-2.png", "ver", "1"]
   ```

5. **Test Grid Display**: After adding inventory tags, you should see:
   - Cards with uniform sizing
   - Accessory images (or fallback icons if images fail to load)
   - Quantity badges
   - Slot badges (headwear/eyewear)
   - Equipped indicators (if any are equipped)

6. **Test Edit Panel**: Click on any accessory card to open the edit panel. Test:
   - Form validation (try invalid values)
   - Save/Equip functionality
   - Remove/Unequip functionality
   - Close button

7. **Test Equipment Management**: 
   - Equip an accessory and verify inventory quantity decreases
   - Unequip an accessory and verify inventory quantity increases
   - Try equipping a different accessory in the same slot (should replace the old one)

## Expected Behavior

### Inventory Tab
- Shows only accessories with qty > 0 from kind 31125
- Cards have uniform 1:1 aspect ratio
- Images use `object-fit: contain` for consistent display
- Shows quantity badges and equipped status

### Edit Panel
- Opens when clicking a card
- Validates all form inputs
- Saves equip tags to kind 31124
- Updates inventory in kind 31125
- Preserves all other tags and content string

### Event Persistence
- Kind 31124: Equip tags for the current Blobbi
- Kind 31125: Inventory tags for the user
- Only relevant tags are modified
- Content string remains unchanged
- "d" tags are preserved

## Known Limitations (for this phase)

- No visual rendering of accessories on the Blobbi
- Only headwear and eyewear slots are supported
- Images may not load if the GitHub repository doesn't exist
- No live updates (requires manual refresh for changes from other clients)
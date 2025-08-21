// Quick debug script to test the z-index calculation
import { calculateBlobbiZIndex, convertToBottomBasedPosition, getZIndexConfigForBackground } from './src/lib/interactive-elements-config.js';

console.log('Testing stage-inside.png configuration:');
const config = getZIndexConfigForBackground('stage-inside.png');
console.log('Config:', JSON.stringify(config, null, 2));

console.log('\nTesting position 95% from top:');
const positionFromBottom = convertToBottomBasedPosition(95);
console.log('Position from bottom:', positionFromBottom);

const zIndex = calculateBlobbiZIndex(95, 'stage-inside.png');
console.log('Calculated z-index:', zIndex);

console.log('\nTesting all thresholds:');
console.log('Position 95% from top (5% from bottom):', calculateBlobbiZIndex(95, 'stage-inside.png'));
console.log('Position 92% from top (8% from bottom):', calculateBlobbiZIndex(92, 'stage-inside.png'));
console.log('Position 85% from top (15% from bottom):', calculateBlobbiZIndex(85, 'stage-inside.png'));
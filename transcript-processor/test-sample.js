// Test script to process the sample transcript
const fs = require('fs');
const path = require('path');

// Define the convertToMarkdown function directly in this file for testing
function convertToMarkdown(transcriptData) {
  let markdown = '# Conversation Transcript\n\n';
  
  // Sort entries by timestamp to ensure chronological order
  const sortedData = [...transcriptData].sort((a, b) => {
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
  
  // Group consecutive entries from the same speaker
  let currentSpeaker = null;
  let currentMessage = '';
  
  sortedData.forEach((entry) => {
    // Only process entries that have a speaker and transcript
    if (entry.speaker && entry.transcript) {
      if (entry.speaker !== currentSpeaker) {
        // If we have accumulated message content for the previous speaker, add it
        if (currentSpeaker && currentMessage) {
          markdown += `**${currentSpeaker}**: ${currentMessage}\n\n`;
        }
        
        // Start new speaker
        currentSpeaker = entry.speaker;
        currentMessage = entry.transcript;
      } else {
        // Continue with same speaker, append the transcript
        currentMessage += ' ' + entry.transcript;
      }
    }
  });
  
  // Add the last speaker's message if exists
  if (currentSpeaker && currentMessage) {
    markdown += `**${currentSpeaker}**: ${currentMessage}\n\n`;
  }
  
  // For debugging purposes, add a raw section with timestamps
  markdown += '## Detailed Transcript (with timestamps)\n\n';
  
  sortedData.forEach((entry) => {
    if (entry.speaker && entry.transcript) {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      markdown += `**${entry.speaker}** (${timestamp}):\n${entry.transcript}\n\n`;
    }
  });
  
  return markdown;
}

// Load the sample transcript
const samplePath = path.join(__dirname, '..', 'sample-transcript.json');
const sampleData = JSON.parse(fs.readFileSync(samplePath, 'utf8'));

// Convert the sample to markdown
const markdown = convertToMarkdown(sampleData);

// Write the markdown to a file
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(path.join(outputDir, 'sample-transcript.md'), markdown);
console.log('Sample transcript converted to markdown and saved to output/sample-transcript.md');

// Also save a simple plain text version for a cleaner view
let plainText = "# Conversation Transcript\n\n";
const speakers = new Set();
sampleData.forEach(entry => {
  if (entry.speaker && entry.transcript) {
    speakers.add(entry.speaker);
  }
});

console.log(`Found ${speakers.size} speakers in the transcript.`);

sampleData
  .filter(entry => entry.speaker && entry.transcript)
  .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  .forEach(entry => {
    plainText += `${entry.speaker}: ${entry.transcript}\n`;
  });

fs.writeFileSync(path.join(outputDir, 'sample-transcript-plain.txt'), plainText);
console.log('Plain text version saved to output/sample-transcript-plain.txt');
// Load environment variables from .env file
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const axios = require('axios');
const fs = require('fs');
const XLSX = require('xlsx');
const MarkdownIt = require('markdown-it');
const { OpenAI } = require('openai');
const { program } = require('commander');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize markdown parser
const md = new MarkdownIt();

// CLI configuration
program
  .name('transcript-processor')
  .description('Process transcript data through various stages')
  .option('-b, --bot-id <id>', 'Bot ID for transcript retrieval')
  .option('-f, --sample-file <path>', 'Path to a sample transcript JSON file')
  .requiredOption('-s, --spreadsheet <path>', 'Path to the spreadsheet file')
  .option('-o, --output <directory>', 'Directory for output files', './output')
  .parse(process.argv);

const options = program.opts();

// Create output directory if it doesn't exist
if (!fs.existsSync(options.output)) {
  fs.mkdirSync(options.output, { recursive: true });
}

// Main function to run the processing pipeline
async function processTranscript() {
  try {
    console.log('Starting transcript processing...');
    
    // Step 1: Get transcript data either from API or sample file
    let transcriptData;
    if (options.botId) {
      console.log(`Fetching transcript data for bot ID: ${options.botId}...`);
      transcriptData = await fetchTranscriptData(options.botId);
    } else if (options.sampleFile) {
      console.log(`Reading transcript data from sample file: ${options.sampleFile}...`);
      transcriptData = JSON.parse(fs.readFileSync(options.sampleFile, 'utf8'));
    } else {
      throw new Error('Either --bot-id or --sample-file must be provided');
    }
    console.log(`Retrieved ${transcriptData.length} transcript entries.`);
    
    // Step 2: Convert transcript data to markdown
    console.log('Converting transcript data to markdown...');
    const markdownContent = convertToMarkdown(transcriptData);
    const markdownPath = path.join(options.output, 'transcript.md');
    fs.writeFileSync(markdownPath, markdownContent);
    console.log(`Markdown saved to: ${markdownPath}`);
    
    // Step 3: Read spreadsheet headers
    console.log(`Reading headers from spreadsheet: ${options.spreadsheet}...`);
    const headers = readSpreadsheetHeaders(options.spreadsheet);
    console.log(`Extracted ${headers.length} headers: ${headers.join(', ')}`);
    
    // Step 4: Extract data using OpenAI based on spreadsheet headers
    console.log('Extracting data using OpenAI...');
    const extractedData = await extractDataWithOpenAI(markdownContent, headers);
    
    // Save the extracted data
    const jsonPath = path.join(options.output, 'extracted_data.json');
    fs.writeFileSync(jsonPath, JSON.stringify(extractedData, null, 2));
    console.log(`Extracted data saved to: ${jsonPath}`);

    // Step 5: Write the extracted data back to the CSV
    console.log('Writing extracted data to CSV...');
    writeDataToCSV(extractedData, options.spreadsheet);
    console.log(`Data written to spreadsheet: ${options.spreadsheet}`);
    
    console.log('Transcript processing completed successfully!');
  } catch (error) {
    console.error('Error during transcript processing:', error.message);
    process.exit(1);
  }
}

// Function to fetch transcript data from the API
async function fetchTranscriptData(botId) {
  try {
    console.log(process.env.TRANSCRIPT_API_ENDPOINT);
    console.log(process.env.TRANSCRIPT_API_KEY);
    const response = await axios.get(`${process.env.TRANSCRIPT_API_ENDPOINT}/api/v1/bots/${botId}/get_transcript`, {
      
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${process.env.TRANSCRIPT_API_KEY}`
      }
    });
    
    if (response.status !== 200) {
      throw new Error(`API returned status code ${response.status}`);
    }
    
    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch transcript data: ${error.message}`);
  }
}

// Function to convert transcript data to markdown
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

// Function to read headers from a spreadsheet
function readSpreadsheetHeaders(spreadsheetPath) {
  try {
    const workbook = XLSX.readFile(spreadsheetPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Get the range of the sheet
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const headers = [];
    
    // Read the first row as headers
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
      const cell = worksheet[cellAddress];
      
      if (cell && cell.v) {
        headers.push(cell.v.toString().trim());
      }
    }
    
    return headers;
  } catch (error) {
    throw new Error(`Failed to read spreadsheet headers: ${error.message}`);
  }
}

// Function to extract data using OpenAI based on spreadsheet headers
async function extractDataWithOpenAI(markdownContent, headers) {
  try {
    // Create a prompt for OpenAI
    const prompt = `
I need to extract specific information from the following transcript.
Please extract the following fields from the transcript:
${headers.map(header => `- ${header}`).join('\n')}

Return the data in a valid JSON format where each field corresponds to the extracted information.
If a field cannot be found, indicate with "Not found in transcript".

Transcript:
${markdownContent}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",  // Using GPT-4 for better extraction capabilities
      messages: [
        {
          role: "system",
          content: "You are an assistant specialized in extracting structured information from conversation transcripts."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3, // Lower temperature for more deterministic responses
    });

    // Parse the OpenAI response
    const content = response.choices[0].message.content;
    
    // Try to extract JSON from the response
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || 
                     content.match(/```\n([\s\S]*?)\n```/) || 
                     content.match(/{[\s\S]*?}/);
                     
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } else {
      // If no JSON format is detected, return the raw response
      console.warn('Could not parse JSON from OpenAI response. Returning raw response.');
      return { raw_response: content };
    }
  } catch (error) {
    throw new Error(`Failed to extract data with OpenAI: ${error.message}`);
  }
}

// Function to write data back to CSV
function writeDataToCSV(data, csvPath) {
  try {
    // Create a row of data in the same order as headers
    const workbook = XLSX.readFile(csvPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Get headers
    const headers = readSpreadsheetHeaders(csvPath);
    
    // Create row data array in the same order as headers
    const rowData = headers.map(header => data[header] || '');
    
    // Get the range
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const newRowIndex = range.e.r + 1;  // Add to the end
    
    // Add new row
    headers.forEach((_, colIndex) => {
      const cellAddress = XLSX.utils.encode_cell({ r: newRowIndex, c: colIndex });
      worksheet[cellAddress] = { t: 's', v: rowData[colIndex] };
    });
    
    // Update range to include new row
    worksheet['!ref'] = XLSX.utils.encode_range({
      s: { c: 0, r: 0 },
      e: { c: range.e.c, r: newRowIndex }
    });
    
    // Write the file
    XLSX.writeFile(workbook, csvPath);
  } catch (error) {
    throw new Error(`Failed to write data to CSV: ${error.message}`);
  }
}

// Export functions for testing
module.exports = {
  convertToMarkdown,
  readSpreadsheetHeaders,
  extractDataWithOpenAI,
  fetchTranscriptData,
  writeDataToCSV
};

// Only run the main function if this file is executed directly (not imported)
if (require.main === module) {
  processTranscript();
}
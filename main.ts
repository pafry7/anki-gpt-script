import { parse } from "https://deno.land/std@0.175.0/flags/mod.ts";
import { config } from "https://deno.land/std@0.167.0/dotenv/mod.ts";

import chunk from "https://raw.githubusercontent.com/lodash/lodash/master/chunk.js";

await config({ path: "./.env.local", export: true });

const OPEN_AI_API_KEY = Deno.env.get("OPEN_AI_API_KEY");
const ANKI_CONNECT_KEY = Deno.env.get("ANKI_CONNECT_KEY");

const DEFAULT_DECK_NAME = "EnglishAI";
const DEFAULT_LANGUAGE = "polish";
const DEFAULT_FILE = "list.txt";

const MODEL = "Vocabulary";

const OPEN_AI_API_URL = "https://api.openai.com/v1/completions";

interface AnkiCardData {
  translation: string;
  context: string;
  word: string;
}

interface GPTChoice {
  index: number;
  text: string;
}

const { file, language, deck } = parse(Deno.args, {
  string: ["deck", "language", "file"],
  default: {
    deck: DEFAULT_DECK_NAME,
    language: DEFAULT_LANGUAGE,
    file: DEFAULT_FILE,
  },
});

const getTranslation = (words: string[]) =>
  fetch(OPEN_AI_API_URL, {
    body: JSON.stringify({
      prompt: words.map(
        (word) =>
          `You are an intelligent translation bot that translates English words into ${language} and provides context for use in Anki spaced repetition cards.\n\nWord: break into sth\nTranslation: włamać się\nContext: Someone broke into our neighbours' car last night.\nWord: ${word}`
      ),
      model: "text-davinci-003",
      temperature: 0,
      max_tokens: 100,
    }),
    headers: {
      Authorization: `Bearer ${OPEN_AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.choices && data.choices.length > 0) {
        return data.choices.map((choice: GPTChoice) => {
          const text = choice.text;
          const translation = text.match(/Translation: (.*)/)?.[1] ?? "ERROR";
          const context = text.match(/Context: (.*)/)?.[1] ?? "ERROR";
          return {
            translation: translation,
            context,
            word: words[choice.index],
          };
        });
      } else {
        return [{ translation: "NOT_FOUND", context: "ERROR", word: "ERROR" }];
      }
    });

const createAnkiCard = ({ word, translation, context }: AnkiCardData) =>
  fetch("http://localhost:8765", {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "addNote",
      version: 6,
      key: ANKI_CONNECT_KEY,
      params: {
        note: {
          deckName: deck,
          modelName: MODEL,
          fields: {
            Term: word,
            Definition: translation,
            Context: context,
          },
          options: {
            allowDuplicate: false,
            duplicateScope: "deck",
            duplicateScopeOptions: {
              deckName: "Default",
              checkChildren: false,
            },
          },
        },
      },
    }),
  });

const createAnkiCardsFromChunk = async (chunk: AnkiCardData[]) => {
  for (const data of chunk) {
    await createAnkiCard(data);
  }
};

const wordsText = await Deno.readTextFile(file);
const wordsList = wordsText.split("\n").filter(Boolean);

const chunks = chunk(wordsList, 20);

// It could be improved with Promise.all, but ankiconnect fails if
// there are too many requests
for (const chunk of chunks) {
  const data = await getTranslation(chunk);
  await createAnkiCardsFromChunk(data);
}

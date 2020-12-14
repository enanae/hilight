import React, { useState, useEffect } from 'react';
import './App.css';
import { API } from 'aws-amplify';
import { withAuthenticator, AmplifySignOut } from '@aws-amplify/ui-react';

import { DataStore } from '@aws-amplify/datastore';
import { Word, LearningStatus } from './models';
import natural from 'natural';
import HighlightedWord from './HighlightedWord'

const initialFormState = { description: '' }

function App() {
  const [words, setWords] = useState([]);
  const [knownWords, setKnownWords] = useState([]);
  const [formData, setFormData] = useState(initialFormState);

  useEffect(() => {
    fetchKnownWords();
  }, []);

  async function fetchKnownWords() {
    var fetchedSeenWords = await DataStore.clear() 
    fetchedSeenWords = await DataStore.query(Word);
    // console.log("Words retrieved successfully!", JSON.stringify(fetchedSeenWords, null, 2));
    setKnownWords(fetchedSeenWords);
  }

  async function storeWord(word) {
    await DataStore.save(word);
  }

  async function handleNewWord(token) {
    const existingWords = await DataStore.query(Word, word => word.stem("eq", token), {
      limit: 1
    })
    if (existingWords.length === 0 || typeof existingWords[0] === 'undefined') {
      // console.log("didn't find in datastore, saving ", token)
      var newWord = new Word({
        "stem": token,
        "variants": token,
        "status": LearningStatus.UNKNOWN
      })
      storeWord(newWord);
      return newWord
    } else {
      // console.log("EXISTING WORD OBJECT")
      // console.log(existingWords[0])
      return existingWords[0]
    }
  }

  async function lookForNewWords(tokens) {
    var newKnownWords = [];
    var newWords = [];
    for (const token of tokens) {
      var wordifiedToken = ""
      // console.log("token is :", token)
      const cachedWord = knownWords.find(word => word.stem === token)
      // console.log("cachedWord is :", cachedWord)
      if (!cachedWord) {
        // console.log("looking in datastore")
        wordifiedToken = await handleNewWord(token)
        // console.log("wordified token after handle is: ", wordifiedToken.stem)
        newKnownWords.push(wordifiedToken)
      } else {
        // console.log("found known: ", cachedWord.stem)
        wordifiedToken = cachedWord
      }
      newWords.push(wordifiedToken)
    }
    const [one, two] = await Promise.all([newWords, newKnownWords])
    // console.log("new words: ")
    // console.log(one)
    // console.log("new known words are: ")
    // console.log(two);
    return [one, two];
  }

  async function saveWords() {
    words.forEach(word => console.log(word));
    if (!formData.description) return;
    // var tokenizer = new natural.WordTokenizer();
    // const tokenized = tokenizer.tokenize(formData.description);
    const tokenized = formData.description.split(" ")
    // console.log("tokenized:", tokenized)
    const [newWords, newKnownWords] = await lookForNewWords(tokenized)
    setWords([...words, ...newWords])
    setKnownWords([...knownWords, ...newKnownWords])
    setFormData(initialFormState);
  }

  // async function deleteNote({ id }) {
  //   const newNotesArray = words.filter(word => word.id !== id);
  //   setWords(newNotesArray);
  //   const modelToDelete = await DataStore.query(Word, id);
  //   DataStore.delete(modelToDelete);
  // }

  async function refreshWordColors(updatedWordStem) {
    const updatedWords = await DataStore.query(Word, word => word.stem("eq", updatedWordStem), {
      limit: 1
    })

    const updatedWord = updatedWords[0];

    console.log(updatedWord)

    setWords(words.map(word => {
      //console.log("checking for update: ", word.stem)
      if (word.stem !== updatedWordStem) {
        return word
      } else {
        // console.log("UPDATING THIS WORD: ", word.stem);
        // console.log(word)
        // console.log("NEW")
        // console.log(updatedWord)
        return updatedWord
      }
    }));
    setKnownWords(knownWords.map(word => {
      //console.log("checking for update: ", word.stem)
      if (word.stem !== updatedWordStem) {
        return word
      } else {
        // console.log("UPDATING THIS KNOWN WORD: ", word.stem);
        // console.log(word)
        // console.log("NEW")
        // console.log(updatedWord)
        return updatedWord
      }
    }));

  }

  return (
    <div className="App">
      <h1>Vocab Highlighter</h1>
      <textarea
        onChange={e => setFormData({ ...formData, 'description': e.target.value })}
        placeholder="Note description"
        value={formData.description}
        style={{
          height: "200px",
          width: "800px"
        }}
      />
      <button onClick={saveWords}>Create Text</button>
      <div style={{ marginBottom: 30 }}>
        <div >
          <p>{words.length}</p>
        </div>
        <div style={{
          margin: "0px auto",
          width: "400px"
        }}>{
            words.map(word => {
              return <div>
                <HighlightedWord updateParent={refreshWordColors}>{word}</HighlightedWord>
              </div>
            }
            )
          }
        </div>
      </div>
      <AmplifySignOut />
    </div>
  );
}

export default withAuthenticator(App);
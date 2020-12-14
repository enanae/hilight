import React, { useState, useEffect } from 'react';

import { DataStore } from '@aws-amplify/datastore';
import { Word, LearningStatus } from './models';


function HighlightedWord({children, updateParent}) {
    const [color, setColor] = useState([]);

    function updateColor(status) {
        var newColor = "black"
        if (status === LearningStatus.LEARNING) {
            newColor = "orange"
        } else if (status === LearningStatus.KNOWN) {
            newColor = "green"
        }
        console.log("setting color to ", newColor)
        setColor(newColor);
    }

    useEffect(() => {
        console.log("word child changed to ", children.status)
        const newColor = updateColor(children.status)
        
    }, [children]);

    function newStatus(original) {
        if (original.status === LearningStatus.UNKNOWN) {
            return LearningStatus.LEARNING;
        } else if (original.status === LearningStatus.LEARNING) {
            return LearningStatus.KNOWN;
        } else if (original.status === LearningStatus.KNOWN) {
            return LearningStatus.UNKNOWN;
        }
    }



    async function shuffleStatus() {

        const wordsWithStem = await DataStore.query(Word, word => word.stem("eq", children.stem));
        const unsafeOriginalWord = wordsWithStem[0];

        console.log("changing ", unsafeOriginalWord.stem, "from status ", unsafeOriginalWord.status, "...");
        
        const updatedStatus = newStatus(unsafeOriginalWord)
        await DataStore.save(
            Word.copyOf(unsafeOriginalWord, updated => {
                updated.status = updatedStatus;
            })
        );

        updateParent(children.stem);
        
        console.log(unsafeOriginalWord.stem, " changed to ", updatedStatus);
    }

    return (
        <div onClick={shuffleStatus}
            style={{
                float: "left",
                color: color,
                marginRight: "10px"
            }}>
            {children.stem}
        </div>
    )

}

export default HighlightedWord;
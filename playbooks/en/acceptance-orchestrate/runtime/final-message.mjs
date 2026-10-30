// Select a whole native final message; never scrape or repair a JSON substring.
export function finalMessage(){let text,done;return {
 observe(event){if(event.type==='text')text=event.payload?.content;if(event.type==='done')done=event.payload;},
 select(response){if(typeof done?.result==='string'&&done.result.trim())return {source:'native-terminal-result',text:done.result};if(typeof text==='string')return {source:'last-complete-native-text-message',text};return {source:'official-player-final-text',text:response.finalText};},
};}

// Tonight's way: booked stops the bus doesn't go to, test mode, bus photos, conductor notes.
export default {
  'You booked {stop}, but the bus doesn’t go there on this trip. You get off at {instead} (or where the road turns off for it).': ['நீங்கள் {stop} ஐ முன்பதிவு செய்தீர்கள், ஆனால் இந்தப் பயணத்தில் பேருந்து அங்கு செல்லாது. நீங்கள் {instead} இல் (அல்லது அதற்குச் சாலை திரும்பும் இடத்தில்) இறங்குவீர்கள்.', 'ඔබ {stop} වෙන් කළා, නමුත් මෙම ගමනේදී බසය එතැනට නොයයි. ඔබ {instead} හිදී (නැත්නම් ඒ සඳහා මාර්ගය හැරෙන තැනින්) බසිනු ඇත.'],
  'You booked {stop}, but the bus doesn’t go there on this trip. You get on at {instead}.': ['நீங்கள் {stop} ஐ முன்பதிவு செய்தீர்கள், ஆனால் இந்தப் பயணத்தில் பேருந்து அங்கு செல்லாது. நீங்கள் {instead} இல் ஏறுவீர்கள்.', 'ඔබ {stop} වෙන් කළා, නමුත් මෙම ගමනේදී බසය එතැනට නොයයි. ඔබ {instead} හිදී නගිනු ඇත.'],
  'Photos of the bus': ['பேருந்தின் புகைப்படங்கள்', 'බසයේ ඡායාරූප'],
  '(It is {code}.)': ['(அது {code}.)', '(එය {code}.)'],
  '{name}, photo {n} of {total}': ['{name}, புகைப்படம் {total} இல் {n}', '{name}, ඡායාරූප {total} න් {n}'],
  'Previous photo': ['முந்தைய புகைப்படம்', 'පෙර ඡායාරූපය'],
  'Next photo': ['அடுத்த புகைப்படம்', 'ඊළඟ ඡායාරූපය'],
  'If not, you get off where the road turns off for it, after {main} (your ticket will then say {main}), and we will tell you by text.': ['இல்லையெனில், {main} க்குப் பிறகு அதற்குச் சாலை திரும்பும் இடத்தில் இறங்குவீர்கள் (உங்கள் டிக்கெட்டில் பின்னர் {main} என்று இருக்கும்), குறுஞ்செய்தியில் தெரிவிப்போம்.', 'නැත්නම්, {main} න් පසු ඒ සඳහා මාර්ගය හැරෙන තැනින් ඔබ බසිනු ඇත (එවිට ඔබේ ටිකට්පතේ {main} ලෙස සඳහන් වේ), අපි කෙටි පණිවිඩයකින් දන්වන්නෙමු.'],
  'If not, you board at {main} (or where the road comes back from it, just before), and we will tell you by text.': ['இல்லையெனில், {main} இல் (அல்லது அதிலிருந்து சாலை திரும்பி வரும் இடத்தில், சற்று முன்பு) ஏறுவீர்கள், குறுஞ்செய்தியில் தெரிவிப்போம்.', 'නැත්නම්, ඔබ {main} හිදී (නැත්නම් එතැන් සිට මාර්ගය නැවත එක් වන තැනින්, ඊට ටිකක් පෙර) නගිනු ඇත, අපි කෙටි පණිවිඩයකින් දන්වන්නෙමු.'],
  'This trip currently goes the “{way}” way, which doesn’t stop at {stop}. Unless more on-request stops fill, you get on at {instead}.': ['இந்தப் பயணம் தற்போது “{way}” வழியில் செல்கிறது, அது {stop} இல் நிற்காது. மேலும் கோரிக்கை நிறுத்தங்கள் நிரம்பாவிட்டால், நீங்கள் {instead} இல் ஏறுவீர்கள்.', 'මෙම ගමන දැනට “{way}” මාර්ගයෙන් යයි, එය {stop} හි නවතින්නේ නැත. තවත් ඉල්ලීම මත නැවතුම් නොපිරුණොත්, ඔබ {instead} හිදී නගිනු ඇත.'],
  'This trip currently goes the “{way}” way, which doesn’t stop at {stop}. Unless more on-request stops fill, you get off at {instead}.': ['இந்தப் பயணம் தற்போது “{way}” வழியில் செல்கிறது, அது {stop} இல் நிற்காது. மேலும் கோரிக்கை நிறுத்தங்கள் நிரம்பாவிட்டால், நீங்கள் {instead} இல் இறங்குவீர்கள்.', 'මෙම ගමන දැනට “{way}” මාර්ගයෙන් යයි, එය {stop} හි නවතින්නේ නැත. තවත් ඉල්ලීම මත නැවතුම් නොපිරුණොත්, ඔබ {instead} හිදී බසිනු ඇත.'],
  'Test mode: no text is sent. Use {code}.': ['சோதனை முறை: குறுஞ்செய்தி அனுப்பப்படாது. {code} ஐப் பயன்படுத்துங்கள்.', 'පරීක්ෂණ ප්‍රකාරය: කෙටි පණිවිඩයක් නොයවයි. {code} භාවිත කරන්න.'],
  'Tonight: the “{name}” way (not every on-request stop filled).': ['இன்றிரவு: “{name}” வழி (எல்லா கோரிக்கை நிறுத்தங்களும் நிரம்பவில்லை).', 'අද රාත්‍රිය: “{name}” මාර්ගය (සියලු ඉල්ලීම මත නැවතුම් පිරුණේ නැත).'],
  'booked {stop}: at the turn-off for it': ['{stop} முன்பதிவு: அதற்குத் திரும்பும் இடத்தில்', '{stop} වෙන් කළා: ඒ සඳහා හැරෙන තැනින්'],
  'booked {stop} (not on tonight’s way)': ['{stop} முன்பதிவு (இன்றிரவு வழியில் இல்லை)', '{stop} වෙන් කළා (අද රාත්‍රියේ මාර්ගයේ නැත)'],
  'Wrong code. (Test mode: the code is {code}.)': ['தவறான குறியீடு. (சோதனை முறை: குறியீடு {code}.)', 'වැරදි කේතය. (පරීක්ෂණ ප්‍රකාරය: කේතය {code}.)'],
};

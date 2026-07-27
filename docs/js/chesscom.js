export async function fetchArchives(username) {
  const resp = await fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}/games/archives`);
  if (!resp.ok) {
    throw new Error('Chess.com: user not found or API error (' + resp.status + ')');
  }
  const json = await resp.json();
  return json.archives;
}

export async function fetchGames(username, fromYm, toYm, onStatus) {
  const from = fromYm || '0000-00';
  const to = toYm || '9999-99';
  const archives = await fetchArchives(username);
  const inRange = archives.filter((url) => {
    const parts = url.split('/');
    const ym = parts[parts.length - 2] + '-' + parts[parts.length - 1];
    return from <= ym && ym <= to;
  });

  const pgnChunks = [];
  for (const url of inRange) {
    const parts = url.split('/');
    const ym = parts[parts.length - 2] + '-' + parts[parts.length - 1];
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error('Chess.com: user not found or API error (' + resp.status + ')');
    }
    const json = await resp.json();
    const games = json.games || [];
    for (const g of games) {
      if (g.pgn && typeof g.pgn === 'string') {
        pgnChunks.push(g.pgn);
      }
    }
    if (onStatus) {
      onStatus('Fetched ' + ym + ': ' + games.length + ' games');
    }
  }

  if (pgnChunks.length === 0) {
    throw new Error('No games found in that range');
  }

  return pgnChunks.join('\n\n');
}

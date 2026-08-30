import { findTopK } from '../utils/vectorMath';

self.onmessage = (event: MessageEvent) => {
  const data = event.data;
  
  if (data.type === 'DENSE_SEARCH') {
    const { requestId, queryEmbedding, candidates, topK } = data.payload;
    
    try {
      // Run the heavy cosine similarity math here in the background thread
      const scoredResults = findTopK(queryEmbedding, candidates, topK);
      
      self.postMessage({
        type: 'DENSE_SEARCH_RESULT',
        payload: {
          requestId,
          results: scoredResults,
        }
      });
    } catch (error: any) {
      self.postMessage({
        type: 'DENSE_SEARCH_ERROR',
        payload: {
          requestId,
          error: error.message || 'Error during dense search'
        }
      });
    }
  }
};

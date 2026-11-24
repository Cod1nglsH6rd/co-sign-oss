import DocumentViewer from '../../[locale]/documents/[id]';

export default DocumentViewer;

export async function getServerSideProps() {
  const messages = require('../../../locales/en.json');
  return { props: { messages } };
}

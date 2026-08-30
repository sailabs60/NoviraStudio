import { useState } from 'react';
import { Camera, Eye, FileText, Video } from 'lucide-react';
import { Section, Segmented } from '../../components/ui';
import { RenderPanel } from './RenderPanel';
import { WalkthroughPanel } from './WalkthroughPanel';
import { OutputPanel } from './OutputPanel';
import { SavedViewsPanel } from '../SavedViews';

type PresentTool = 'render' | 'views' | 'video' | 'documents';

/**
 * Present.
 *
 * Everything that leaves the product: images, video, drawings and the deck.
 * Grouped together because they are one moment in the work — "this is finished,
 * now I have to send it" — and separating a render from the deck it goes into
 * means doing that moment in two places.
 */
export function PresentPanel() {
  const [tool, setTool] = useState<PresentTool>('render');

  return (
    <>
      <Section title="">
        <Segmented
          value={tool}
          columns={2}
          options={[
            { value: 'render', label: 'Images', hint: 'Fast renders and pro renders, up to 4K.', icon: <Camera className="h-3.5 w-3.5" /> },
            {
              value: 'views',
              label: 'Views',
              hint: 'Named viewpoints a client can navigate the plan with.',
              icon: <Eye className="h-3.5 w-3.5" />,
            },
            { value: 'video', label: 'Video', hint: 'Camera moves and an exported walkthrough.', icon: <Video className="h-3.5 w-3.5" /> },
            { value: 'documents', label: 'Documents', hint: 'Drawings, CAD, quantities and the client deck.', icon: <FileText className="h-3.5 w-3.5" /> },
          ]}
          onChange={setTool}
        />
      </Section>

      {tool === 'render' ? <RenderPanel /> : null}
      {tool === 'views' ? <SavedViewsPanel /> : null}
      {tool === 'video' ? <WalkthroughPanel /> : null}
      {tool === 'documents' ? <OutputPanel /> : null}
    </>
  );
}

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'app/settings/integrations/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add import
if (!content.includes('AccurateSettingsModal')) {
  content = content.replace(
    "import { Card } from '@/components/ui/Card'",
    "import { Card } from '@/components/ui/Card'\nimport AccurateSettingsModal from '@/lib/integrations/accurate/AccurateSettingsModal'"
  );
}

// 2. Remove states
const stateRegex = /\s*\/\/\s*Accurate Form State\s*const \[accurateClientId, setAccurateClientId\] = useState\(''\)\s*const \[accurateClientSecret, setAccurateClientSecret\] = useState\(''\)\s*const \[accurateAccessToken, setAccurateAccessToken\] = useState\(''\)\s*const \[accurateDbId, setAccurateDbId\] = useState\(''\)\s*const \[isSyncingAccurate, setIsSyncingAccurate\] = useState\(false\)/g;
content = content.replace(stateRegex, '');

// 3. Remove populate logic
const populateRegex = /\s*\/\/\s*Populate Accurate form if exists\s*if \(accurate\.config\) \{\s*setAccurateClientId\(accurate\.config\.client_id \|\| ''\)\s*setAccurateClientSecret\(accurate\.config\.client_secret \|\| ''\)\s*setAccurateAccessToken\(accurate\.config\.access_token \|\| ''\)\s*setAccurateDbId\(accurate\.config\.db_id \|\| ''\)\s*\}/g;
content = content.replace(populateRegex, '');

// 4. Remove handleSaveAccurate and handleSyncAccurate
const handleRegex = /\s*\/\/\s*Handle Save Accurate Integration[\s\S]*?(?=\s*\/\/\s*Handle Save WooCommerce Integration)/;
content = content.replace(handleRegex, '\n\n');

// 5. Replace render block
const renderBlockStartStr = "{/* ACCURATE CONFIGURATION MODAL / DRAWER */}";
const woocommerceBlockStartStr = "{/* WOOCOMMERCE CONFIGURATION MODAL / DRAWER */}";
const renderBlockRegex = /\{\/\*\s*ACCURATE CONFIGURATION MODAL \/ DRAWER\s*\*\/\}[\s\S]*?(?=\{\/\*\s*WOOCOMMERCE CONFIGURATION MODAL \/ DRAWER\s*\*\/\})/g;

const replacementRender = `{/* ACCURATE CONFIGURATION MODAL / DRAWER */}
      {selectedPlugin?.id === 'accurate' && mounted && createPortal(
        <AccurateSettingsModal
          selectedPlugin={selectedPlugin}
          setSelectedPlugin={setSelectedPlugin}
          activeBusiness={activeBusiness}
          onSaveSuccess={fetchIntegrations}
        />,
        document.body
      )}

      `;

if (content.match(renderBlockRegex)) {
    content = content.replace(renderBlockRegex, replacementRender);
} else {
    console.log("Could not find render block via Regex. Trying string split.");
    const parts1 = content.split('{/* ACCURATE CONFIGURATION MODAL / DRAWER */}');
    if (parts1.length > 1) {
        const parts2 = parts1[1].split('{/* WOOCOMMERCE CONFIGURATION MODAL / DRAWER */}');
        content = parts1[0] + replacementRender + '{/* WOOCOMMERCE CONFIGURATION MODAL / DRAWER */}' + parts2[1];
    }
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Refactor completed successfully.');

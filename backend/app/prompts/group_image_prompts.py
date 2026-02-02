"""
Prompt templates for AI image generation
Version: 1.0.0
"""

from typing import Dict, List

# Version info
PROMPT_VERSION = "1.0.0"
PROMPT_LAST_UPDATED = "2026-01-31"

# Subject-specific prompt templates for educational group cover images
GROUP_IMAGE_PROMPTS: Dict[str, str] = {
    "math": """
educational mathematics classroom with diverse students learning together, 
colorful mathematical formulas and geometric shapes on whiteboard, 
bright modern learning environment with natural lighting, 
students engaged in problem-solving, calculators and math books visible, 
warm and inviting atmosphere, professional photography style, high quality, detailed
""",
    "science": """
modern science laboratory with students conducting experiments, 
colorful chemicals in glass beakers and test tubes, 
microscopes and scientific equipment, 
educational setting with safety equipment visible, 
bright lighting, clean white surfaces, 
students in lab coats working collaboratively, 
professional educational photography, high quality, detailed
""",
    "english": """
cozy library reading corner with comfortable seating, 
students reading books together in small groups, 
warm ambient lighting from desk lamps, 
floor-to-ceiling bookshelves filled with colorful books, 
literary posters on walls, plants and warm decor, 
educational atmosphere, peaceful study environment, 
professional photography style, high quality, detailed
""",
    "history": """
historical timeline display covering classroom walls, 
maps of ancient civilizations and world history, 
educational artifacts and replicas on display shelves, 
students examining historical documents, 
warm museum-style lighting, rich wooden furniture, 
globe and historical figures portraits visible, 
educational museum atmosphere, 
professional photography, high quality, detailed
""",
    "art": """
vibrant art studio with natural light streaming through large windows, 
colorful paintings and artwork on walls, 
students creating art with various supplies - paint, brushes, canvases, 
creative mess with art materials organized on tables, 
inspirational posters and color wheels visible, 
warm and creative atmosphere, 
professional photography style, high quality, detailed
""",
    "music": """
music classroom with various instruments - piano, guitars, drums, violins, 
students practicing music together in a band setup, 
sheet music stands and acoustic panels on walls, 
warm wooden floors and comfortable seating, 
music notes decorations on walls, 
warm stage lighting atmosphere, 
educational setting, professional photography, high quality, detailed
""",
    "computing": """
modern computer lab with rows of monitors displaying code, 
students programming and working on projects, 
tech equipment and gadgets visible on desks, 
blue ambient lighting accents, clean minimalist design, 
large screens showing code and applications, 
 futuristic but educational atmosphere, 
professional photography style, high quality, detailed
""",
    "coding": """
modern coding classroom with multiple computer screens, 
students typing code with focused expressions, 
neon accent lighting in blue and purple tones, 
whiteboards with algorithms and flowcharts, 
comfortable ergonomic chairs and modern desks, 
tech startup atmosphere blended with education, 
professional photography, high quality, detailed
""",
    "programming": """
software development learning environment with large monitors, 
students collaborating on coding projects, 
coffee cups and notebooks on modern desks, 
code projected on screens, whiteboards with diagrams, 
casual professional atmosphere with educational focus, 
warm lighting mixed with screen glow, 
professional photography style, high quality, detailed
""",
    "sports": """
outdoor sports field or indoor gymnasium with athletic equipment, 
students in athletic wear practicing team sports, 
basketball hoops, soccer goals, or tennis rackets visible, 
bright daylight or energetic gym lighting, 
team spirit and dynamic action poses, 
energetic and healthy atmosphere, 
professional sports photography style, high quality, detailed
""",
    "physical_education": """
gymnasium with exercise equipment and sports gear, 
students engaged in physical activities and team games, 
colorful gym mats and balls, 
bright fluorescent lighting, action and movement captured, 
healthy active lifestyle atmosphere, 
educational sports setting, 
professional photography, high quality, detailed
""",
    "geography": """
geography classroom with large world maps on walls, 
globes and atlases on desks, 
students examining maps and geographical models, 
posters of different countries and cultures, 
compasses and measuring tools visible, 
earth tones and natural colors, 
educational exploration atmosphere, 
professional photography style, high quality, detailed
""",
    "chemistry": """
chemistry laboratory with students conducting experiments, 
colorful chemical reactions in beakers, 
periodic table poster on wall, 
safety goggles and lab equipment, 
bunsen burners with blue flames, 
clean white lab benches, 
scientific discovery atmosphere, 
professional educational photography, high quality, detailed
""",
    "physics": """
physics classroom with experiments and demonstrations, 
pendulums, inclined planes, and motion demonstrations, 
physics formulas on whiteboard, 
students conducting hands-on experiments, 
models of atoms and molecules visible, 
bright classroom lighting, 
discovery and learning atmosphere, 
professional photography style, high quality, detailed
""",
    "biology": """
biology laboratory with microscopes and specimen slides, 
students examining cells and organisms, 
models of DNA, cells, and body systems, 
plants and aquariums in the classroom, 
posters of ecosystems and life cycles, 
natural and scientific atmosphere, 
professional educational photography, high quality, detailed
""",
    "literature": """
literature classroom with classic books and reading materials, 
students discussing books in a circle, 
comfortable seating with cushions and bean bags, 
posters of famous authors and literary quotes, 
warm coffee shop atmosphere blended with classroom, 
cozy and intellectual environment, 
professional photography style, high quality, detailed
""",
    "language": """
language learning classroom with international decorations, 
students practicing conversation in pairs, 
flags of different countries on walls, 
language learning posters and flashcards, 
cultural artifacts and maps, 
welcoming multicultural atmosphere, 
professional educational photography, high quality, detailed
""",
    "default": """
modern educational classroom with diverse students learning together collaboratively, 
bright and welcoming atmosphere with natural lighting, 
warm wooden desks and comfortable seating, 
educational posters and student work on walls, 
technology integrated with traditional learning tools, 
engaged and happy students, 
professional photography style, warm tones, high quality, detailed
""",
}

# Keywords that trigger each subject template
SUBJECT_KEYWORDS: Dict[str, List[str]] = {
    "math": [
        "math",
        "mathematics",
        "algebra",
        "calculus",
        "geometry",
        "trigonometry",
        "arithmetic",
        "statistics",
    ],
    "science": ["science", "scientific", "laboratory", "lab", "experiment"],
    "english": [
        "english",
        "literature",
        "reading",
        "writing",
        "grammar",
        "language arts",
    ],
    "history": [
        "history",
        "historical",
        "ancient",
        "civilization",
        "war",
        "culture",
        "heritage",
    ],
    "art": ["art", "drawing", "painting", "creative", "design", "craft", "visual arts"],
    "music": [
        "music",
        "band",
        "orchestra",
        "choir",
        "singing",
        "instrument",
        "piano",
        "guitar",
    ],
    "computing": ["computer", "computing", "ict", "information technology", "digital"],
    "coding": [
        "coding",
        "programming",
        "software",
        "development",
        "app",
        "web development",
    ],
    "programming": [
        "programming",
        "software engineering",
        "coding",
        "computer science",
        "algo",
    ],
    "sports": [
        "sport",
        "athletic",
        "team",
        "basketball",
        "soccer",
        "football",
        "tennis",
        "volleyball",
    ],
    "physical_education": [
        "physical education",
        "pe",
        "gym",
        "fitness",
        "health",
        "exercise",
    ],
    "geography": [
        "geography",
        "geographical",
        "maps",
        "countries",
        "continents",
        "earth",
    ],
    "chemistry": ["chemistry", "chemical", "compound", "molecule", "reaction"],
    "physics": ["physics", "physical", "force", "motion", "energy", "quantum"],
    "biology": [
        "biology",
        "biological",
        "life science",
        "organism",
        "cell",
        "ecosystem",
    ],
    "literature": ["literature", "literary", "novel", "poetry", "prose", "classic"],
    "language": [
        "language",
        "linguistic",
        "foreign language",
        "spanish",
        "french",
        "german",
        "chinese",
    ],
}


def get_prompt_for_group(group_name: str, description: str = "") -> str:
    """
    Generate an appropriate image prompt based on group name and description.

    Args:
        group_name: The name of the student group
        description: Optional description to help guide image generation

    Returns:
        A detailed prompt string for image generation
    """
    text = f"{group_name} {description}".lower()

    # Check for subject keywords
    for subject, keywords in SUBJECT_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            return GROUP_IMAGE_PROMPTS[subject].strip()

    # Default prompt with group name incorporated
    return f"educational group named '{group_name}', {GROUP_IMAGE_PROMPTS['default'].strip()}"


def get_all_subjects() -> List[str]:
    """Get list of all available subject templates."""
    return list(GROUP_IMAGE_PROMPTS.keys())


def get_prompt_version() -> Dict[str, str]:
    """Get current prompt version information."""
    return {
        "version": PROMPT_VERSION,
        "last_updated": PROMPT_LAST_UPDATED,
        "total_templates": str(len(GROUP_IMAGE_PROMPTS)),
        "total_subjects": str(len(SUBJECT_KEYWORDS)),
    }

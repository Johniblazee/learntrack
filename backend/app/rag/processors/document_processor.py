"""
Unified Document Processing using langchain-docling
Replaces multiple document processors with a single LangChain-based solution
"""

import os
import tempfile
import threading
from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Union
from pathlib import Path
import structlog

from langchain_core.documents import Document
from langchain_docling import DoclingLoader
from langchain_docling.loader import ExportType

logger = structlog.get_logger()


@dataclass
class ProcessingOptions:
    """Configuration options for document processing"""

    use_semantic_chunking: bool = True
    preserve_structure: bool = True
    chunk_size: int = 1000
    chunk_overlap: int = 200
    export_type: ExportType = ExportType.MARKDOWN


class DocumentProcessor:
    """
    Unified document processor using langchain-docling
    Supports multiple file formats with a single interface
    """

    def __init__(self):
        # Supported file extensions
        self.supported_extensions = {
            # PDF formats
            ".pdf",
            # Office formats
            ".docx",
            ".doc",
            ".pptx",
            ".ppt",
            ".xlsx",
            ".xls",
            # Text formats
            ".txt",
            ".md",
            ".rtf",
            # Image formats (for OCR)
            ".png",
            ".jpg",
            ".jpeg",
            ".tiff",
            ".bmp",
            # Other formats supported by docling
            ".html",
            ".htm",
            ".xml",
            ".json",
        }

        logger.info(
            "Initialized DocumentProcessor with langchain-docling",
            supported_formats=list(self.supported_extensions),
        )

    async def load_document(
        self,
        file_path: Union[str, Path],
        export_type: ExportType = ExportType.MARKDOWN,
        **loader_kwargs,
    ) -> List[Document]:
        """
        Load document using langchain-docling

        Args:
            file_path: Path to the document
            export_type: Export format (MARKDOWN, TEXT, JSON)
            **loader_kwargs: Additional parameters for DoclingLoader
        """
        try:
            file_path = Path(file_path)

            if not file_path.exists():
                raise FileNotFoundError(f"File not found: {file_path}")

            if file_path.suffix.lower() not in self.supported_extensions:
                raise ValueError(
                    f"Unsupported file format: {file_path.suffix}. "
                    f"Supported formats: {self.supported_extensions}"
                )

            # Create DoclingLoader with the specified export type
            loader = DoclingLoader(
                file_path=str(file_path), export_type=export_type, **loader_kwargs
            )

            # Load documents
            documents = await loader.aload()

            # Add metadata to documents
            for doc in documents:
                doc.metadata.update(
                    {
                        "source_file": str(file_path),
                        "filename": file_path.name,
                        "file_extension": file_path.suffix.lower(),
                        "file_size": file_path.stat().st_size,
                        "export_type": export_type.value,
                        "processor": "langchain-docling",
                    }
                )

            logger.info(
                "Successfully loaded document",
                filename=file_path.name,
                documents_count=len(documents),
                export_type=export_type.value,
                file_size=file_path.stat().st_size,
            )

            return documents

        except Exception as e:
            logger.error(
                "Failed to load document",
                error=str(e),
                file_path=str(file_path),
            )
            raise

    async def load_from_bytes(
        self,
        file_bytes: bytes,
        filename: str,
        export_type: ExportType = ExportType.MARKDOWN,
        **loader_kwargs,
    ) -> List[Document]:
        """
        Load document from bytes (useful for uploaded files)
        """
        try:
            # Create temporary file
            with tempfile.NamedTemporaryFile(
                delete=False, suffix=Path(filename).suffix
            ) as temp_file:
                temp_file.write(file_bytes)
                temp_path = temp_file.name

            try:
                # Load from temporary file
                documents = await self.load_document(
                    temp_path, export_type=export_type, **loader_kwargs
                )

                # Update filename in metadata
                for doc in documents:
                    doc.metadata["filename"] = filename
                    doc.metadata["original_filename"] = filename

                return documents

            finally:
                # Clean up temporary file
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

        except Exception as e:
            logger.error(
                "Failed to load document from bytes",
                error=str(e),
                filename=filename,
            )
            raise

    async def load_with_structure_preservation(
        self, file_path: Union[str, Path], **kwargs
    ) -> List[Document]:
        """
        Load document with maximum structure preservation
        """
        return await self.load_document(
            file_path, export_type=ExportType.MARKDOWN, **kwargs
        )

    async def load_as_text(
        self, file_path: Union[str, Path], **kwargs
    ) -> List[Document]:
        """
        Load document as plain text (minimal formatting)
        """
        return await self.load_document(
            file_path, export_type=ExportType.TEXT, **kwargs
        )

    async def load_with_metadata(
        self, file_path: Union[str, Path], **kwargs
    ) -> List[Document]:
        """
        Load document with rich metadata
        """
        return await self.load_document(
            file_path, export_type=ExportType.JSON, **kwargs
        )

    def is_supported(self, file_path: Union[str, Path]) -> bool:
        """Check if file format is supported"""
        extension = Path(file_path).suffix.lower()
        return extension in self.supported_extensions

    def get_supported_formats(self) -> List[str]:
        """Get list of supported file formats"""
        return sorted(list(self.supported_extensions))

    async def extract_text_only(self, file_path: Union[str, Path], **kwargs) -> str:
        """
        Extract plain text content from document
        """
        try:
            documents = await self.load_as_text(file_path, **kwargs)

            # Combine all document content
            text_content = "\n\n".join(doc.page_content for doc in documents)

            return text_content.strip()

        except Exception as e:
            logger.error(
                "Failed to extract text",
                error=str(e),
                file_path=str(file_path),
            )
            raise

    async def get_document_metadata(
        self, file_path: Union[str, Path], **kwargs
    ) -> Dict[str, Any]:
        """
        Get rich metadata about the document
        """
        try:
            documents = await self.load_with_metadata(file_path, **kwargs)

            if not documents:
                return {}

            # Start with first document's metadata, then add explicit keys
            # This prevents document metadata from overwriting explicit keys
            combined_metadata = dict(documents[0].metadata)

            # Add explicit metadata keys (these take precedence)
            combined_metadata.update(
                {
                    "total_documents": len(documents),
                    "total_characters": sum(len(doc.page_content) for doc in documents),
                    "source_file": str(file_path),
                    "filename": Path(file_path).name,
                    "file_extension": Path(file_path).suffix.lower(),
                    "processor": "langchain-docling",
                }
            )

            return combined_metadata

        except Exception as e:
            logger.error(
                "Failed to get document metadata",
                error=str(e),
                file_path=str(file_path),
            )
            raise


# Global instance for convenience
_default_document_processor = None
_default_document_processor_lock = threading.Lock()


def get_document_processor() -> DocumentProcessor:
    """Get or create default document processor"""
    global _default_document_processor
    with _default_document_processor_lock:
        if _default_document_processor is None:
            _default_document_processor = DocumentProcessor()
    return _default_document_processor


def create_document_processor() -> DocumentProcessor:
    """Create a new document processor instance"""
    return DocumentProcessor()


# Convenience functions for common use cases
async def load_document(
    file_path: Union[str, Path], export_type: ExportType = ExportType.MARKDOWN, **kwargs
) -> List[Document]:
    """Load document using default processor"""
    processor = get_document_processor()
    return await processor.load_document(file_path, export_type, **kwargs)


async def load_document_from_bytes(
    file_bytes: bytes,
    filename: str,
    export_type: ExportType = ExportType.MARKDOWN,
    **kwargs,
) -> List[Document]:
    """Load document from bytes using default processor"""
    processor = get_document_processor()
    return await processor.load_from_bytes(file_bytes, filename, export_type, **kwargs)


async def extract_text_from_document(file_path: Union[str, Path], **kwargs) -> str:
    """Extract plain text from document"""
    processor = get_document_processor()
    return await processor.extract_text_only(file_path, **kwargs)
